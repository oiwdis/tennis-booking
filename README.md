# Sports Court Booking

This app can run in two modes:

- `file` mode for local testing with `data/bookings.json`
- `supabase` mode for real online deployment with durable shared storage

It can also send confirmation emails with cancel and reschedule links when email env vars are configured.

## Run locally

```bash
node server.js
```

Then open `http://localhost:3000`.

## Deploy online

This project is ready to deploy to a Node host like Render or Railway.

### 1. Push the folder to GitHub

Include:

- `index.html`
- `styles.css`
- `app.js`
- `server.js`
- `package.json`

### 2. Create a Supabase table

Create a table named `bookings` with these columns:

- `id` text primary key
- `manage_token` text unique not null
- `name` text
- `email` text
- `date` text
- `start_time` text
- `end_time` text
- `sport` text

### 3. Add environment variables in your host

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_TABLE=bookings`
- `PUBLIC_BASE_URL`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `EMAIL_REPLY_TO` optional

### 4. Deploy

Use:

- Build command: none
- Start command: `npm start`

The server automatically uses Supabase when those environment variables are present. Otherwise it falls back to the local JSON file.

## Supabase SQL

```sql
create table if not exists bookings (
  id text primary key,
  manage_token text unique not null,
  name text not null,
  email text not null,
  date text not null,
  start_time text not null,
  end_time text not null,
  sport text not null
);
```

## Email setup

For confirmation emails, this app uses Resend through the server.

- `PUBLIC_BASE_URL` should be your deployed site URL, for example `https://your-app.onrender.com`
- `RESEND_API_KEY` should be your Resend API key
- `EMAIL_FROM` should be a verified sender, for example `Court Booking <bookings@yourdomain.com>`
- `EMAIL_REPLY_TO` is optional