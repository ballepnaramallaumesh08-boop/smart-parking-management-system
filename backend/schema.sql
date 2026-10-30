#include <stdio.h>
#include "database.h"

int run_http_server(sqlite3 *db);

int main(void)
{
    sqlite3 *db = NULL;
    if (db_open(&db, "smartparking.db") != SQLITE_OK) {
        fprintf(stderr, "Could not open SQLite database.\n");
        if (db) sqlite3_close(db);
        return 1;
    }

    if (db_initialize(db) != SQLITE_OK) {
        sqlite3_close(db);
        return 1;
    }

    printf("SQLite database ready: smartparking.db\n");
    int result = run_http_server(db);
    sqlite3_close(db);
    return result;
}
