FROM gcc:12

WORKDIR /app

COPY . .

RUN gcc -I. main.c server.c database.c hashing.c sqlite3.c -o smartparking

ENV PORT=8080

EXPOSE 8080

CMD ["./smartparking"]