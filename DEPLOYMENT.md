# Render deployment

This project requires a paid Render web service because SQLite data is stored
on a persistent disk.

1. Run `npm run hash-password`, type a password of at least 12 characters,
   and copy the resulting `scrypt$...` value.
2. Build `AGENT_ACCOUNTS` using `passwordHash` for every agent.
3. Push this repository to GitHub.
4. In Render, create a Blueprint from the repository's `render.yaml`.
5. Enter every value marked `sync: false`:
   - `APP_ORIGIN`: the final HTTPS site URL, without a trailing slash.
   - `BOOKING_TIMEZONE_OFFSET`: the business offset, such as `-04:00`.
   - `AGENT_ACCOUNTS`: the JSON account array.
   - Every payment destination.
6. Deploy, then verify `/api/health`, the booking flow, chat, and `/agent`.

Edit the site locally or through GitHub and push to the connected branch.
Render redeploys the new commit automatically. Secrets can be changed in the
Render dashboard; changing agent IDs can be blocked when stored records still
reference those IDs.
