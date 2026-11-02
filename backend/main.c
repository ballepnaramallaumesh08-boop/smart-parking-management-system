
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
typedef SOCKET socket_t;
#define CLOSESOCKET closesocket
#else
#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
typedef int socket_t;
#define CLOSESOCKET close
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

#include "database.h"
#include "hashing.h"

#define PORT (getenv("PORT") ? atoi(getenv("PORT")) : 8080)
#define REQUEST_CAP 16384
#define RESPONSE_CAP 60000

static void handle_client(socket_t client, sqlite3 *db)
{
    char request[REQUEST_CAP] = {0};

    int got = recv(client, request, sizeof(request) - 1, 0);

    if (got <= 0)
    {
        CLOSESOCKET(client);
        return;
    }

    request[got] = '\0';

    char method[8] = {0};
    char path[256] = {0};

    if (sscanf(request, "%7s %255s", method, path) != 2)
    {
        send_response(
            client,
            400,
            "Bad Request",
            "{\"error\":\"Invalid HTTP request\"}"
        );

        CLOSESOCKET(client);
        return;
    }

    printf("Request received: %s %s\n", method, path);
    fflush(stdout);

    if (strcmp(method, "OPTIONS") == 0)
    {
        send_response(client, 200, "OK", "{\"ok\":true}");
    }

    else if (
        strcmp(method, "GET") == 0 &&
        strcmp(path, "/") == 0
    )
    {
        send_response(
            client,
            200,
            "OK",
            "{\"message\":\"Smart Parking backend is running\"}"
        );
    }

    else if (
        strcmp(method, "GET") == 0 &&
        strcmp(path, "/api/bookings") == 0
    )
    {
        char body[RESPONSE_CAP] = {0};

        if (db_list_bookings(db, body, sizeof(body)) == 0)
        {
            send_response(client, 200, "OK", body);
        }
        else
        {
            send_response(
                client,
                500,
                "Internal Server Error",
                "{\"error\":\"Could not read bookings\"}"
            );
        }
    }

    else if (
        strcmp(method, "POST") == 0 &&
        strcmp(path, "/api/bookings") == 0
    )
    {
        char name[128];
        char vehicle[64];
        char vehicleType[32];
        char location[128];
        char slot[32];
        char date[32];
        char time[32];

        if (
            !json_value(request, "name", name, sizeof(name)) ||
            !json_value(request, "vehicle", vehicle, sizeof(vehicle)) ||
            !json_value(request, "vehicleType", vehicleType, sizeof(vehicleType)) ||
            !json_value(request, "location", location, sizeof(location)) ||
            !json_value(request, "slot", slot, sizeof(slot)) ||
            !json_value(request, "date", date, sizeof(date)) ||
            !json_value(request, "time", time, sizeof(time))
        )
        {
            send_response(
                client,
                400,
                "Bad Request",
                "{\"error\":\"Required fields: name, vehicle, vehicleType, location, slot, date, time\"}"
            );
        }
        else
        {
            char key[512];

            snprintf(
                key,
                sizeof(key),
                "%s|%s|%s|%s",
                vehicle,
                slot,
                date,
                time
            );

            unsigned long long h = hashBookingKey(key);

            int rc = db_add_booking(
                db,
                name,
                vehicle,
                vehicleType,
                location,
                slot,
                date,
                time,
                h
            );

            if (rc == 0)
            {
                send_response(
                    client,
                    201,
                    "Created",
                    "{\"ok\":true,\"message\":\"Booking created\"}"
                );
            }
            else if (rc == 1)
            {
                send_response(
                    client,
                    409,
                    "Conflict",
                    "{\"error\":\"This slot is already booked for that date and time\"}"
                );
            }
            else
            {
                send_response(
                    client,
                    500,
                    "Internal Server Error",
                    "{\"error\":\"Could not save booking\"}"
                );
            }
        }
    }

    else if (
        strcmp(method, "POST") == 0 &&
        strncmp(path, "/api/bookings/cancel?id=", 24) == 0
    )
    {
        int id = atoi(path + 24);

        int rc = db_cancel_booking(db, id);

        if (rc > 0)
        {
            send_response(
                client,
                200,
                "OK",
                "{\"ok\":true,\"message\":\"Booking cancelled\"}"
            );
        }
        else if (rc == 0)
        {
            send_response(
                client,
                404,
                "Not Found",
                "{\"error\":\"Active booking not found\"}"
            );
        }
        else
        {
            send_response(
                client,
                500,
                "Internal Server Error",
                "{\"error\":\"Could not cancel booking\"}"
            );
        }
    }

    else
    {
        send_response(
            client,
            404,
            "Not Found",
            "{\"error\":\"Route not found\"}"
        );
    }

    CLOSESOCKET(client);
}
int main(void)
{
    sqlite3 *db = NULL;

    /* Your database initialization code */

    int result = run_http_server(db);

    sqlite3_close(db);

    return result;
}