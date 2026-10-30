-- Smart Parking Management System database schema (SQLite)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    vehicle TEXT NOT NULL,
    vehicle_type TEXT NOT NULL DEFAULT 'Car',
    location TEXT NOT NULL,
    slot TEXT NOT NULL,
    booking_date TEXT NOT NULL,
    booking_time TEXT NOT NULL,
    booking_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_booking_hash ON bookings(booking_hash);
CREATE INDEX IF NOT EXISTS idx_slot_date_time
ON bookings(slot, booking_date, booking_time, status);
