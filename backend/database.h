#ifndef DATABASE_H
#define DATABASE_H

#include <sqlite3.h>

int db_open(sqlite3 **db, const char *filename);
int db_initialize(sqlite3 *db);

int db_add_booking(
sqlite3 *db,
const char *name,
const char *vehicle,
const char *vehicle_type,
const char *location,
const char *slot,
const char *booking_date,
const char *booking_time,
unsigned long long booking_hash
);

int db_list_bookings(sqlite3 *db, char *out, int out_size);
int db_cancel_booking(sqlite3 *db, int id);

#endif
