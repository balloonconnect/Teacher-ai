# Run Karkai AI with Docker

Karkai AI (கற்கை AI) is a Tamil Nadu Samacheer Kalvi AI teaching platform. This guide starts the whole app on your computer or a server with one command.

## 1. What you need
- **Docker Desktop** (Windows or Mac) or Docker Engine with the Compose plugin (Linux). Check with `docker --version` and `docker compose version`.
- About **4 GB of free RAM** and 5 GB of disk space.
- The project folder (this repository), unzipped or cloned: `git clone https://github.com/balloonconnect/Kavli.git`

## 2. Start it
Open a terminal in the project folder and run:

```
docker compose up --build
```

The first build takes several minutes (it installs Tamil text-reading data). When the log says `Karkai AI API listening`, open **http://localhost:3001**.

To run it in the background instead: `docker compose up --build -d`

## 3. Sign in
The Docker setup creates demo accounts the first time it starts with an empty database. All use the password `demo@12345`:

| Role | Email |
|---|---|
| Platform admin | admin@demo.kavli.local |
| Student | meena@demo.kavli.local |
| Teacher | teacher@demo.kavli.local |
| Parent | parent@demo.kavli.local |

If "Email or password is incorrect" appears for the admin, your database was created before the demo accounts existed. Create or reset an admin (section 6).

## 4. Add your textbook
1. Sign in as admin and open **Class books** in the left menu.
2. Choose the class (for example 8), subject (Tamil) and medium (Tamil), then upload the PDF.
3. Wait until the status says **Ready**. The lessons then appear under **Learn** for students of that class.

The app is set to show **only uploaded textbook content** (`BOOK_ONLY=1` in `docker-compose.yml`). Built-in sample lessons, tests and practice questions are removed.

## 5. Connect the AI model and voice (optional)
Create a file named `.env` next to `docker-compose.yml` and add your keys, then restart:

```
ANTHROPIC_API_KEY=your-key
AZURE_SPEECH_KEY=your-key
AZURE_SPEECH_REGION=your-region
```

Without these the tutor uses a simple rule-based mode and the browser's own voice. Answers and Tamil quality can only be judged with a real model connected.

## 6. Create or reset an admin
Pick your own email and password (10+ characters with a letter and a number):

```
docker compose exec -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='YourPassw0rd-2026' -e ADMIN_RESET=1 app node_modules/.bin/tsx scripts/create-admin.ts
```

## 7. Everyday commands
| Task | Command |
|---|---|
| Stop | `docker compose down` |
| Start again | `docker compose up -d` |
| See logs | `docker compose logs app --tail 100` |
| Update to the latest code | `git pull` then `docker compose up --build -d` |
| List uploaded books | `docker compose exec db psql -U kavli -d kavli -c "SELECT id,title,class_level,page_count,status,created_at FROM textbooks;"` |
| Back up the database | `docker compose exec db pg_dump -U kavli kavli > backup.sql` |
| Delete everything and start fresh | `docker compose down -v` (this erases all data) |

## 8. Remove an uploaded book
Open **Class books** as admin and delete it there. This removes the PDF, its pages and its lessons. To remove all books at once, run in order:

```
docker compose exec db psql -U kavli -d kavli -c "BEGIN; DELETE FROM item_ai WHERE lesson_id LIKE 'bk-%'; DELETE FROM item_progress WHERE lesson_id LIKE 'bk-%'; DELETE FROM lesson_progress WHERE lesson_id LIKE 'bk-%'; DELETE FROM bookmarks WHERE kind='lesson' AND ref LIKE 'bk-%'; DELETE FROM lessons WHERE id LIKE 'bk-%'; DELETE FROM questions WHERE origin='book' AND id NOT IN (SELECT question_id FROM test_questions); DELETE FROM textbook_chapters; DELETE FROM textbook_pages; DELETE FROM textbooks; COMMIT;"
docker compose restart s3
```

## 9. Going live
Before real students use it: set `SEED_DEMO=0` and `NODE_ENV=production`, use your own long `SESSION_SECRET`, serve it over HTTPS on your domain, back up the database regularly, and make sure you have permission to host the textbook. See `docs/DEPLOYMENT.md` for the full list.

## 10. Troubleshooting
- **Port 3001 is busy:** change `"3001:3001"` in `docker-compose.yml`, for example to `"8080:3001"`, and open http://localhost:8080.
- **Build fails with no space left:** run `docker system prune`.
- **Page is blank after an update:** run `docker compose up --build -d` so the new build is used, then hard-refresh the browser.
- **Book stays on "processing":** reading a long scanned book takes a while. Check `docker compose logs app --tail 100`.
