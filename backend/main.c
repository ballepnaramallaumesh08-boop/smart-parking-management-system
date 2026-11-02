
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

static void send_response(
    socket_t client,
    int status,
    const char *reason,
    const char *body
)
{
    char head[512];
    int body_len = (int)strlen(body);

    int n = snprintf(
        head,
        sizeof(head),
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        "Access-Control-Allow-Headers: Content-Type\r\n"
        "Content-Length: %d\r\n"
        "Connection: close\r\n\r\n",
        status,
        reason,
        body_len
    );

    send(client, head, n, 0);
    send(client, body, body_len, 0);
}

/* JSON helper for this learning prototype. */
static int json_value(
    const char *json,
    const char *key,
    char *out,
    size_t out_cap
)
{
    char pattern[100];

    snprintf(pattern, sizeof(pattern), "\"%s\"", key);

    const char *p = strstr(json, pattern);

    if (!p)
        return 0;

    p = strchr(p + strlen(pattern), ':');

    if (!p)
        return 0;

    p++;

    while (*p && isspace((unsigned char)*p))
        p++;

    if (*p != '"')
        return 0;

    p++;

    size_t i = 0;

    while (*p && *p != '"' && i + 1 < out_cap)
    {
        if (*p == '\\' && p[1])
            p++;

        out[i++] = *p++;
    }

    out[i] = '\0';

    return 1;
}

static void handle_client(socket_t client, sqlite3 *db)
{
    char request[REQUEST_CAP];

    int got = recv(client, request, sizeof(request) - 1, 0);

    if (got <= 0)
    {
        CLOSESOCKET(client);
        return;
    }

    request[got] = '\0';

    char method[8] = {0};
    char path[256] = {0};

    sscanf(request, "%7s %255s", method, path);

    if (strcmp(method, "OPTIONS") == 0)
    {
        send_response(client, 200, "OK", "{\"ok\":true}");
    }

    /* Temporary root route to test the deployed backend. */
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
        char body[RESPONSE_CAP];

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

int run_http_server(sqlite3 *db)
{
#ifdef _WIN32
    WSADATA wsa;

    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0)
    {
        fprintf(stderr, "Winsock initialization failed\n");
        return 1;
    }
#endif

    socket_t server = socket(AF_INET, SOCK_STREAM, 0);

    if (server < 0)
    {
        perror("socket");
        return 1;
    }

    struct sockaddr_in addr;

    memset(&addr, 0, sizeof(addr));

    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port = htons(PORT);

    if (bind(server, (struct sockaddr *)&addr, sizeof(addr)) < 0)
    {
        fprintf(
            stderr,
            "Could not bind port %d. Is another server using it?\n",
            PORT
        );

        CLOSESOCKET(server);
        return 1;
    }

    if (listen(server, 10) < 0)
    {
        fprintf(stderr, "listen failed\n");

        CLOSESOCKET(server);
        return 1;
    }

    printf(
        "Smart Parking C backend running at http://localhost:%d\n",
        PORT
    );

    printf(
        "Bookings API: http://localhost:%d/api/bookings\n",
        PORT
    );

    printf("Press Ctrl+C to stop.\n");

    for (;;)
    {
        socket_t client = accept(server, NULL, NULL);

        if (client >= 0)
            handle_client(client, db);
    }
}

int main(void)
{
    sqlite3 *db = NULL;

    /*
       Use DB_PATH when provided.
       Otherwise, use smartparking.db locally.
    */
    const char *db_path = getenv("DB_PATH");

    if (db_path == NULL || db_path[0] == '\0')
    {
        db_path = "smartparking.db";
    }

    if (db_open(&db, db_path) != SQLITE_OK)
    {
        fprintf(stderr, "Failed to open database.\n");
        return 1;
    }

    if (db_initialize(db) != SQLITE_OK)
    {
        fprintf(stderr, "Failed to initialize database.\n");

        sqlite3_close(db);
        return 1;
    }

    int result = run_http_server(db);

    sqlite3_close(db);

    return result;
}

