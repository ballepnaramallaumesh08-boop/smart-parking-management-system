#include "database.h"
#include <stdio.h>
#include <string.h>

int db_open(sqlite3 **db, const char *filename)
{
    return sqlite3_open(filename, db);
}

int db_initialize(sqlite3 *db)
{
    const char *sql =
        "PRAGMA foreign_keys = ON;"
        "CREATE TABLE IF NOT EXISTS bookings ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT,"
        " name TEXT NOT NULL,"
        " vehicle TEXT NOT NULL,"
        " vehicle_type TEXT NOT NULL DEFAULT 'Car',"
        " location TEXT NOT NULL,"
        " slot TEXT NOT NULL,"
        " booking_date TEXT NOT NULL,"
        " booking_time TEXT NOT NULL,"
        " booking_hash TEXT NOT NULL,"
        " status TEXT NOT NULL DEFAULT 'Active',"
        " created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"
        ");"
        "CREATE INDEX IF NOT EXISTS idx_booking_hash ON bookings(booking_hash);"
        "CREATE INDEX IF NOT EXISTS idx_slot_date_time ON bookings(slot, booking_date, booking_time, status);";
    char *err = NULL;
    int rc = sqlite3_exec(db, sql, NULL, NULL, &err);
    if (rc != SQLITE_OK) {
        fprintf(stderr, "Database initialization error: %s\n", err ? err : "unknown");
        sqlite3_free(err);
    }
    return rc;
}

int db_add_booking(sqlite3 *db, const char *name, const char *vehicle,
                   const char *vehicle_type, const char *location,
                   const char *slot, const char *date, const char *time,
                   unsigned long long booking_hash)
{
    const char *check_sql =
        "SELECT COUNT(*) FROM bookings "
        "WHERE slot=? AND booking_date=? AND booking_time=? AND status='Active'";
    sqlite3_stmt *check = NULL;
    if (sqlite3_prepare_v2(db, check_sql, -1, &check, NULL) != SQLITE_OK) return -1;
    sqlite3_bind_text(check, 1, slot, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(check, 2, date, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(check, 3, time, -1, SQLITE_TRANSIENT);

    int busy = 0;
    if (sqlite3_step(check) == SQLITE_ROW) busy = sqlite3_column_int(check, 0);
    sqlite3_finalize(check);
    if (busy) return 1; /* slot/time conflict */

    const char *sql =
        "INSERT INTO bookings(name, vehicle, vehicle_type, location, slot, booking_date, booking_time, booking_hash)"
        " VALUES(?,?,?,?,?,?,?,?)";
    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) != SQLITE_OK) return -1;

    char hash_text[32];
    snprintf(hash_text, sizeof(hash_text), "%llu", booking_hash);
    sqlite3_bind_text(stmt, 1, name, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, vehicle, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, vehicle_type, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 4, location, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 5, slot, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 6, date, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 7, time, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 8, hash_text, -1, SQLITE_TRANSIENT);

    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    return rc == SQLITE_DONE ? 0 : -1;
}

/* JSON escaping for simple text fields returned by this demo API. */
static void append_json_string(char *out, int cap, int *pos, const unsigned char *s)
{
    if (*pos >= cap - 1) return;
    out[(*pos)++] = '"';
    while (s && *s && *pos < cap - 8) {
        unsigned char c = *s++;
        if (c == '"' || c == '\\') { out[(*pos)++] = '\\'; out[(*pos)++] = (char)c; }
        else if (c == '\n') { out[(*pos)++] = '\\'; out[(*pos)++] = 'n'; }
        else if (c == '\r') { out[(*pos)++] = '\\'; out[(*pos)++] = 'r'; }
        else if (c >= 32) out[(*pos)++] = (char)c;
    }
    if (*pos < cap - 1) out[(*pos)++] = '"';
}

int db_list_bookings(sqlite3 *db, char *out, int out_size)
{
    const char *sql = "SELECT id,name,vehicle,vehicle_type,location,slot,booking_date,booking_time,status,booking_hash FROM bookings ORDER BY id DESC";
    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) != SQLITE_OK) return -1;

    int pos = 0, first = 1;
    if (out_size < 3) { sqlite3_finalize(stmt); return -1; }
    out[pos++] = '[';
    while (sqlite3_step(stmt) == SQLITE_ROW && pos < out_size - 256) {
        if (!first) out[pos++] = ',';
        first = 0;
        pos += snprintf(out + pos, out_size - pos, "{\"id\":%d,\"name\":",
                        sqlite3_column_int(stmt, 0));
        append_json_string(out, out_size, &pos, sqlite3_column_text(stmt, 1));
        pos += snprintf(out + pos, out_size - pos, ",\"vehicle\":");
        append_json_string(out, out_size, &pos, sqlite3_column_text(stmt, 2));
        pos += snprintf(out + pos, out_size - pos, ",\"vehicleType\":");
        append_json_string(out, out_size, &pos, sqlite3_column_text(stmt, 3));
        pos += snprintf(out + pos, out_size - pos, ",\"location\":");
        append_json_string(out, out_size, &pos, sqlite3_column_text(stmt, 4));
        pos += snprintf(out + pos, out_size - pos, ",\"slot\":");
        append_json_string(out, out_size, &pos, sqlite3_column_text(stmt, 5));
        pos += snprintf(out + pos, out_size - pos, ",\"date\":");
        append_json_string(out, out_size, &pos, sqlite3_column_text(stmt, 6));
        pos += snprintf(out + pos, out_size - pos, ",\"time\":");
        append_json_string(out, out_size, &pos, sqlite3_column_text(stmt, 7));
        pos += snprintf(out + pos, out_size - pos, ",\"status\":");
        append_json_string(out, out_size, &pos, sqlite3_column_text(stmt, 8));
        pos += snprintf(out + pos, out_size - pos, ",\"bookingHash\":");
        append_json_string(out, out_size, &pos, sqlite3_column_text(stmt, 9));
        pos += snprintf(out + pos, out_size - pos, "}");
    }
    if (pos < out_size - 1) out[pos++] = ']';
    out[pos] = '\0';
    sqlite3_finalize(stmt);
    return 0;
}

int db_cancel_booking(sqlite3 *db, int id)
{
    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(db, "UPDATE bookings SET status='Cancelled' WHERE id=? AND status='Active'", -1, &stmt, NULL) != SQLITE_OK)
        return -1;
    sqlite3_bind_int(stmt, 1, id);
    int rc = sqlite3_step(stmt);
    int changed = sqlite3_changes(db);
    sqlite3_finalize(stmt);
    return rc == SQLITE_DONE ? changed : -1;
}
