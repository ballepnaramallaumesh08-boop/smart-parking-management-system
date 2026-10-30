document.addEventListener("DOMContentLoaded", function () {
    "use strict";

    const API_BASE = "http://localhost:8080/api";

    let bookingsCache = [];
    let bookingRequestInProgress = false;
    let lastBookingLoadFailed = false;
    let autoRefreshTimer = null;

    // ==========================================
    // COMMON HELPERS
    // ==========================================

    function normalizeText(value) {
        return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    }

    function normalizeSlot(value) {
        return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
    }

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, function (character) {
            return {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            }[character];
        });
    }

    function isCancelled(booking) {
        return normalizeText(booking.status) === "cancelled";
    }

    function isActiveBooking(booking) {
        return !isCancelled(booking);
    }

    function formatTime(value) {
        if (!value) return "Not specified";

        const match = String(value).match(/^(\d{1,2}):(\d{2})/);

        if (!match) return String(value);

        let hours = Number(match[1]);
        const minutes = match[2];
        const period = hours >= 12 ? "PM" : "AM";

        hours = hours % 12 || 12;

        return `${hours}:${minutes} ${period}`;
    }

    function showMessage(element, message, isError = false) {
        if (!element) {
            console.log(message);
            return;
        }

        element.textContent = message;
        element.classList.remove("error", "success");
        element.classList.add(isError ? "error" : "success");
    }

    async function readResponse(response) {
        const text = await response.text();

        if (!text) return {};

        try {
            return JSON.parse(text);
        } catch {
            throw new Error("The backend returned an invalid JSON response.");
        }
    }

    // ==========================================
    // FOOTER YEAR
    // ==========================================

    document.querySelectorAll("[data-year]").forEach(function (element) {
        element.textContent = new Date().getFullYear();
    });

    // ==========================================
    // MOBILE NAVIGATION
    // ==========================================

    const menuToggle = document.querySelector(".menu-toggle");
    const navLinks = document.querySelector(".nav-links");

    if (menuToggle && navLinks) {
        menuToggle.addEventListener("click", function () {
            navLinks.classList.toggle("open");

            menuToggle.setAttribute(
                "aria-expanded",
                String(navLinks.classList.contains("open"))
            );
        });

        navLinks.querySelectorAll("a").forEach(function (link) {
            link.addEventListener("click", function () {
                navLinks.classList.remove("open");
                menuToggle.setAttribute("aria-expanded", "false");
            });
        });
    }

    // ==========================================
    // ADMIN PANEL ELEMENTS
    // ==========================================

    const adminBookingList = document.getElementById("admin-booking-list");
    const adminEmpty = document.getElementById("admin-empty");
    const refreshBookingsButton = document.getElementById("refresh-bookings");

    const totalBookingsElement = document.getElementById("total-bookings");
    const activeBookingsElement = document.getElementById("active-bookings");
    const cancelledBookingsElement = document.getElementById("cancelled-bookings");

    function renderAdminDashboard() {
        if (!adminBookingList) return;

        const activeBookings = bookingsCache.filter(isActiveBooking);
        const cancelledBookings = bookingsCache.filter(isCancelled);

        if (totalBookingsElement) {
            totalBookingsElement.textContent = bookingsCache.length;
        }

        if (activeBookingsElement) {
            activeBookingsElement.textContent = activeBookings.length;
        }

        if (cancelledBookingsElement) {
            cancelledBookingsElement.textContent = cancelledBookings.length;
        }

        if (bookingsCache.length === 0) {
            adminBookingList.innerHTML = "";

            if (adminEmpty) {
                adminEmpty.hidden = false;
                adminEmpty.textContent = lastBookingLoadFailed
                    ? "Unable to load bookings. Check that the C backend is running."
                    : "No bookings found. Create a booking on the Find Parking page.";

                adminEmpty.classList.toggle(
                    "admin-error",
                    lastBookingLoadFailed
                );
            }

            return;
        }

        if (adminEmpty) {
            adminEmpty.hidden = true;
            adminEmpty.classList.remove("admin-error");
        }

        adminBookingList.innerHTML = bookingsCache.map(function (booking) {
            const cancelled = isCancelled(booking);
            const status = booking.status || "Active";

            return `
                <tr>
                    <td>${escapeHTML(booking.id)}</td>
                    <td>${escapeHTML(booking.name || "Customer")}</td>
                    <td>${escapeHTML(booking.vehicle || "")}</td>
                    <td>${escapeHTML(booking.vehicleType || "Car")}</td>
                    <td>${escapeHTML(booking.location || "")}</td>
                    <td>${escapeHTML(booking.slot || "")}</td>
                    <td>${escapeHTML(booking.date || "")}</td>
                    <td>${escapeHTML(formatTime(booking.time))}</td>
                    <td>
                        <span class="admin-status ${cancelled ? "cancelled" : "confirmed"}">
                            ${escapeHTML(status)}
                        </span>
                    </td>
                    <td>
                        <button
                            type="button"
                            class="admin-action"
                            data-admin-cancel-id="${escapeHTML(booking.id)}"
                            ${cancelled ? "disabled" : ""}>
                            ${cancelled ? "Cancelled" : "Cancel"}
                        </button>
                    </td>
                </tr>
            `;
        }).join("");
    }

    // ==========================================
    // BOOKING PAGE ELEMENTS
    // ==========================================

    const bookingForm = document.getElementById("booking-form");
    const bookingMessage = document.getElementById("booking-message");
    const bookingList = document.getElementById("booking-list");

    const slotGrid = document.getElementById("slot-grid");
    const selectedSlotInput = document.getElementById("selected-slot");

    const bookingLocation = document.getElementById("booking-location");
    const bookingDate = document.getElementById("booking-date");
    const bookingTime = document.getElementById("booking-time");

    const clearBookingsButton = document.getElementById("clear-bookings");

    let availabilityStatus = document.getElementById("availability-status");
    let availabilityNote = document.getElementById("availability-note");

    if (slotGrid && !availabilityStatus) {
        availabilityStatus = document.createElement("p");
        availabilityStatus.id = "availability-status";
        availabilityStatus.className = "status-pill";
        availabilityStatus.setAttribute("role", "status");
        availabilityStatus.setAttribute("aria-live", "polite");

        slotGrid.insertAdjacentElement("afterend", availabilityStatus);
    }

    if (slotGrid && !availabilityNote) {
        availabilityNote = document.createElement("p");
        availabilityNote.id = "availability-note";
        availabilityNote.className = "small-note";
        availabilityNote.textContent =
            "Select a location, date and arrival time to check availability.";

        (availabilityStatus || slotGrid).insertAdjacentElement(
            "afterend",
            availabilityNote
        );
    }

    // ==========================================
    // BOOKING HISTORY
    // ==========================================

    function renderBookings() {
        if (!bookingList) return;

        if (bookingsCache.length === 0) {
            bookingList.innerHTML =
                '<p class="empty-state">No bookings available yet.</p>';
            return;
        }

        bookingList.innerHTML = bookingsCache.map(function (booking) {
            const cancelled = isCancelled(booking);
            const status = booking.status || "Active";

            return `
                <div class="booking-item">
                    <h3>${escapeHTML(booking.name || "Customer")}</h3>

                    <p><strong>Booking ID:</strong> ${escapeHTML(booking.id)}</p>
                    <p><strong>Vehicle Number:</strong> ${escapeHTML(booking.vehicle || "")}</p>
                    <p><strong>Vehicle Type:</strong> ${escapeHTML(booking.vehicleType || "Car")}</p>
                    <p><strong>Parking Location:</strong> ${escapeHTML(booking.location || "")}</p>
                    <p><strong>Parking Slot:</strong> ${escapeHTML(booking.slot || "")}</p>
                    <p><strong>Arrival Date:</strong> ${escapeHTML(booking.date || "")}</p>
                    <p><strong>Arrival Time:</strong> ${escapeHTML(formatTime(booking.time))}</p>

                    <p>
                        <strong>Status:</strong>
                        <span class="booking-status ${cancelled ? "cancelled" : "confirmed"}">
                            ${escapeHTML(status)}
                        </span>
                    </p>

                    ${
                        cancelled
                            ? "<p>This booking has been cancelled.</p>"
                            : `
                                <button
                                    type="button"
                                    class="button button-outline cancel-booking-btn"
                                    data-id="${escapeHTML(booking.id)}">
                                    Cancel Booking
                                </button>
                            `
                    }
                </div>
            `;
        }).join("");
    }

    // ==========================================
    // LIVE PARKING SLOT AVAILABILITY
    // ==========================================

    function refreshSlotAvailability() {
        if (!slotGrid) return;

        const location = bookingLocation ? bookingLocation.value.trim() : "";
        const date = bookingDate ? bookingDate.value : "";
        const time = bookingTime ? bookingTime.value : "";

        const slots = Array.from(slotGrid.querySelectorAll(".slot"));

        slots.forEach(function (slot) {
            slot.classList.remove("occupied", "unavailable");
            slot.classList.add("available");
            slot.disabled = false;

            const label = slot.querySelector("span");
            if (label) label.textContent = "Available";
        });

        if (!location || !date || !time) {
            if (availabilityStatus) {
                availabilityStatus.textContent = "Availability not checked";
            }

            if (availabilityNote) {
                availabilityNote.textContent =
                    "Select a location, date and arrival time to check available slots.";
            }

            if (selectedSlotInput) selectedSlotInput.value = "";

            slots.forEach(function (slot) {
                slot.classList.remove("selected");
            });

            return;
        }

        const activeBookings = bookingsCache.filter(function (booking) {
            return (
                isActiveBooking(booking) &&
                normalizeText(booking.location) === normalizeText(location) &&
                String(booking.date || "") === date &&
                String(booking.time || "").slice(0, 5) === time
            );
        });

        const bookedSlots = new Set(
            activeBookings.map(function (booking) {
                return normalizeSlot(booking.slot);
            })
        );

        let availableCount = 0;

        slots.forEach(function (slot) {
            const slotName = slot.dataset.slot || slot.textContent.trim();
            const label = slot.querySelector("span");

            if (bookedSlots.has(normalizeSlot(slotName))) {
                slot.classList.remove("available", "selected");
                slot.classList.add("occupied");
                slot.disabled = true;

                if (label) label.textContent = "Booked";

                if (
                    selectedSlotInput &&
                    normalizeSlot(selectedSlotInput.value) === normalizeSlot(slotName)
                ) {
                    selectedSlotInput.value = "";
                }
            } else {
                availableCount++;
            }
        });

        if (availabilityStatus) {
            availabilityStatus.textContent =
                `${availableCount} parking slot${availableCount === 1 ? "" : "s"} available`;
        }

        if (availabilityNote) {
            availabilityNote.textContent =
                `Availability for ${location} on ${date} at ${formatTime(time)}.`;
        }
    }

    [bookingLocation, bookingDate, bookingTime].forEach(function (field) {
        if (!field) return;

        field.addEventListener("change", function () {
            if (selectedSlotInput) selectedSlotInput.value = "";

            document.querySelectorAll(".slot.selected").forEach(function (slot) {
                slot.classList.remove("selected");
            });

            refreshSlotAvailability();
        });

        field.addEventListener("input", refreshSlotAvailability);
    });

    // ==========================================
    // SELECT PARKING SLOT
    // ==========================================

    function selectParkingSlot(slot) {
        if (!selectedSlotInput) return;

        if (
            slot.disabled ||
            slot.classList.contains("occupied") ||
            slot.classList.contains("unavailable")
        ) {
            showMessage(bookingMessage, "This parking slot is already booked.", true);
            return;
        }

        const location = bookingLocation ? bookingLocation.value : "";
        const date = bookingDate ? bookingDate.value : "";
        const time = bookingTime ? bookingTime.value : "";

        if (!location || !date || !time) {
            showMessage(
                bookingMessage,
                "Please select a parking location, date and arrival time first.",
                true
            );
            return;
        }

        document.querySelectorAll(".slot.selected").forEach(function (item) {
            item.classList.remove("selected");
        });

        slot.classList.add("selected");

        const slotName = slot.dataset.slot || slot.textContent.trim();
        selectedSlotInput.value = slotName;

        showMessage(bookingMessage, `Parking slot ${slotName} selected.`);
    }

    if (slotGrid) {
        slotGrid.addEventListener("click", function (event) {
            const slot = event.target.closest(".slot");

            if (!slot || !slotGrid.contains(slot)) return;

            selectParkingSlot(slot);
        });
    }

    // ==========================================
    // LOAD ALL BOOKINGS FROM BACKEND
    // ==========================================

    async function loadBookings() {
        if (bookingRequestInProgress) return;

        bookingRequestInProgress = true;

        if (refreshBookingsButton) {
            refreshBookingsButton.disabled = true;
            refreshBookingsButton.textContent = "Loading...";
        }

        try {
            const response = await fetch(`${API_BASE}/bookings`, {
                method: "GET",
                cache: "no-store"
            });

            const data = await readResponse(response);

            if (!response.ok) {
                throw new Error(
                    data.error || `Unable to load bookings (HTTP ${response.status}).`
                );
            }

            // The backend must return an array containing all database records.
            if (!Array.isArray(data)) {
                throw new Error("The bookings API did not return a JSON array.");
            }

            bookingsCache = data;
            lastBookingLoadFailed = false;

            renderBookings();
            renderAdminDashboard();
            refreshSlotAvailability();

        } catch (error) {
            console.error("Unable to load bookings:", error);
            lastBookingLoadFailed = true;

            if (adminBookingList) {
                adminBookingList.innerHTML = `
                    <tr>
                        <td colspan="10" class="admin-error">
                            ${escapeHTML(error.message || "Unable to load bookings.")}
                            Check that your C backend is running at
                            http://localhost:8080.
                        </td>
                    </tr>
                `;

                if (adminEmpty) adminEmpty.hidden = true;
            }

            if (bookingList) {
                bookingList.innerHTML = `
                    <p class="empty-state">
                        Unable to load bookings. Check the C backend connection.
                    </p>
                `;
            }

            if (availabilityStatus) {
                availabilityStatus.textContent = "Unable to check availability";
            }

            if (availabilityNote) {
                availabilityNote.textContent =
                    "Check the backend connection and refresh the page.";
            }

        } finally {
            bookingRequestInProgress = false;

            if (refreshBookingsButton) {
                refreshBookingsButton.disabled = false;
                refreshBookingsButton.textContent = "Refresh";
            }
        }
    }

    // ==========================================
    // CANCEL BOOKING THROUGH BACKEND
    // ==========================================

    async function cancelBooking(bookingId) {
        const booking = bookingsCache.find(function (item) {
            return String(item.id) === String(bookingId);
        });

        if (!booking) {
            window.alert("Booking not found. Refresh the page and try again.");
            return;
        }

        if (isCancelled(booking)) return;

        if (!window.confirm("Are you sure you want to cancel this booking?")) {
            return;
        }

        try {
            const response = await fetch(
                `${API_BASE}/bookings/cancel?id=${encodeURIComponent(bookingId)}`,
                { method: "POST" }
            );

            const result = await readResponse(response);

            if (!response.ok) {
                throw new Error(
                    result.error || `Cancellation failed (HTTP ${response.status}).`
                );
            }

            await loadBookings();

            window.alert(`Booking ${bookingId} cancellation request completed.`);

        } catch (error) {
            console.error("Cancellation error:", error);

            window.alert(
                error.message ||
                "Unable to cancel the booking. Check the backend cancellation endpoint."
            );
        }
    }

    if (adminBookingList) {
        adminBookingList.addEventListener("click", function (event) {
            const button = event.target.closest("[data-admin-cancel-id]");

            if (!button || button.disabled) return;

            cancelBooking(button.dataset.adminCancelId);
        });
    }

    if (bookingList) {
        bookingList.addEventListener("click", function (event) {
            const button = event.target.closest(".cancel-booking-btn");

            if (!button) return;

            cancelBooking(button.dataset.id);
        });
    }

    if (refreshBookingsButton) {
        refreshBookingsButton.addEventListener("click", loadBookings);
    }

    // ==========================================
    // MINIMUM BOOKING DATE
    // ==========================================

    if (bookingDate) {
        const today = new Date();

        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, "0");
        const day = String(today.getDate()).padStart(2, "0");

        bookingDate.min = `${year}-${month}-${day}`;
    }

    // ==========================================
    // CREATE NEW BOOKING
    // ==========================================

    if (bookingForm) {
        bookingForm.addEventListener("submit", async function (event) {
            event.preventDefault();

            const formData = new FormData(bookingForm);

            const name = String(formData.get("fullName") || "").trim();

            const vehicleNumber = String(
                formData.get("vehicleNumber") || ""
            ).trim().toUpperCase();

            const date = String(formData.get("date") || "").trim();
            const time = String(formData.get("time") || "").trim();

            const slot = String(
                formData.get("slot") ||
                (selectedSlotInput ? selectedSlotInput.value : "") ||
                ""
            ).trim();

            const vehicleType = String(
                formData.get("vehicleType") || "car"
            ).trim().toLowerCase();

            const location = bookingLocation
                ? bookingLocation.value.trim()
                : String(formData.get("location") || "").trim();

            if (!name || !vehicleNumber || !date || !time || !slot || !location) {
                showMessage(
                    bookingMessage,
                    "Complete all fields and select a parking slot.",
                    true
                );
                return;
            }

            if (vehicleType !== "car") {
                showMessage(bookingMessage, "Only cars are allowed.", true);
                return;
            }

            const selectedDate = new Date(date + "T00:00:00");
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (
                Number.isNaN(selectedDate.getTime()) ||
                selectedDate < today
            ) {
                showMessage(
                    bookingMessage,
                    "Please select today or a future date.",
                    true
                );
                return;
            }

            const duplicate = bookingsCache.some(function (booking) {
                return (
                    isActiveBooking(booking) &&
                    normalizeSlot(booking.slot) === normalizeSlot(slot) &&
                    String(booking.date || "") === date &&
                    String(booking.time || "").slice(0, 5) === time &&
                    normalizeText(booking.location) === normalizeText(location)
                );
            });

            if (duplicate) {
                showMessage(
                    bookingMessage,
                    "This slot is already booked for the selected date and time.",
                    true
                );

                await loadBookings();
                return;
            }

            const bookingData = {
                name: name,
                vehicle: vehicleNumber,
                vehicleType: "Car",
                location: location,
                slot: slot,
                date: date,
                time: time
            };

            try {
                const response = await fetch(`${API_BASE}/bookings`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(bookingData)
                });

                const result = await readResponse(response);

                if (!response.ok) {
                    throw new Error(
                        result.error || `Booking failed (HTTP ${response.status}).`
                    );
                }

                bookingForm.reset();

                if (selectedSlotInput) selectedSlotInput.value = "";

                document.querySelectorAll(".slot.selected").forEach(function (item) {
                    item.classList.remove("selected");
                });

                await loadBookings();

                showMessage(
                    bookingMessage,
                    `Booking submitted successfully for parking slot ${slot}.`
                );

            } catch (error) {
                console.error("Booking error:", error);

                showMessage(
                    bookingMessage,
                    error.message || "Unable to save your booking.",
                    true
                );
            }
        });
    }

    // ==========================================
    // CLEAR BOOKINGS BUTTON
    // ==========================================

    if (clearBookingsButton) {
        clearBookingsButton.addEventListener("click", function () {
            showMessage(
                bookingMessage,
                "Please cancel bookings individually. Clear-all is not configured in the backend.",
                true
            );
        });
    }

    // ==========================================
    // CONTACT FORM
    // ==========================================

    const contactForm = document.getElementById("contact-form");

    if (contactForm) {
        contactForm.addEventListener("submit", function (event) {
            event.preventDefault();

            if (!contactForm.checkValidity()) {
                contactForm.reportValidity();
                return;
            }

            const message = document.getElementById("contact-message");

            if (message) {
                message.textContent =
                    "Thank you! Your message has been received.";
            }

            contactForm.reset();
        });
    }

    // ==========================================
    // REGISTRATION FORM
    // ==========================================

    const registerForm = document.getElementById("register-form");

    if (registerForm) {
        registerForm.addEventListener("submit", function (event) {
            event.preventDefault();

            if (!registerForm.checkValidity()) {
                registerForm.reportValidity();
                return;
            }

            const message = document.getElementById("register-message");

            if (message) {
                message.textContent =
                    "Registration form validated. Backend account creation is not configured.";
            }

            registerForm.reset();
        });
    }

    // ==========================================
    // LOGIN FORM
    // ==========================================

    const loginForm = document.getElementById("login-form");

    if (loginForm) {
        loginForm.addEventListener("submit", function (event) {
            event.preventDefault();

            if (!loginForm.checkValidity()) {
                loginForm.reportValidity();
                return;
            }

            const message = document.getElementById("login-message");

            if (message) {
                message.textContent =
                    "Login form validated. Backend authentication is not configured.";
            }
        });
    }

    // ==========================================
    // INITIAL LOAD AND AUTO-REFRESH
    // ==========================================

    loadBookings();

    autoRefreshTimer = window.setInterval(function () {
        if (!document.hidden) {
            loadBookings();
        }
    }, 5000);

    window.addEventListener("beforeunload", function () {
        if (autoRefreshTimer !== null) {
            window.clearInterval(autoRefreshTimer);
        }
    });
});