const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = __dirname;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "bookings.json");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || "bookings";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "";
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || "";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";
const EMAIL_FEATURES_ENABLED = Boolean(RESEND_API_KEY && EMAIL_FROM);

const STORAGE_MODE =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "file";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, "[]\n", "utf8");
  }
}

function isValidDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function isValidTime(time) {
  return /^\d{2}:\d{2}$/.test(time);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function addOneHour(time) {
  const [hourText = "0", minuteText = "00"] = time.split(":");
  const totalMinutes = Number(hourText) * 60 + Number(minuteText) + 60;
  const wrappedMinutes = totalMinutes % (24 * 60);
  const hour = String(Math.floor(wrappedMinutes / 60)).padStart(2, "0");
  const minute = String(wrappedMinutes % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

function bookingsOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function formatTime(time) {
  const [hourText = "0", minute = "00"] = time.split(":");
  const hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

function formatTimeRange(startTime, endTime) {
  return `${formatTime(startTime)} - ${formatTime(endTime)}`;
}

function sportLabel(sport) {
  return sport.charAt(0).toUpperCase() + sport.slice(1);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character];
  });
}

function normalizeStoredBooking(input) {
  const startTime =
    typeof input.startTime === "string" && input.startTime.trim()
      ? input.startTime.trim()
      : typeof input.start_time === "string" && input.start_time.trim()
        ? input.start_time.trim()
        : typeof input.time === "string" && input.time.trim()
          ? input.time.trim()
          : "";

  const endTime =
    typeof input.endTime === "string" && input.endTime.trim()
      ? input.endTime.trim()
      : typeof input.end_time === "string" && input.end_time.trim()
        ? input.end_time.trim()
        : startTime
          ? addOneHour(startTime)
          : "";

  const manageToken =
    typeof input.manageToken === "string" && input.manageToken.trim()
      ? input.manageToken.trim()
      : typeof input.manage_token === "string" && input.manage_token.trim()
        ? input.manage_token.trim()
        : randomUUID();

  return {
    id: typeof input.id === "string" && input.id.trim() ? input.id.trim() : randomUUID(),
    manageToken,
    name: typeof input.name === "string" ? input.name.trim() : "",
    email: typeof input.email === "string" ? input.email.trim().toLowerCase() : "",
    date: typeof input.date === "string" ? input.date.trim() : "",
    startTime,
    endTime,
    sport: typeof input.sport === "string" ? input.sport.trim().toLowerCase() : "",
  };
}

function normalizeBooking(input) {
  return normalizeStoredBooking(input);
}

function publicBooking(booking) {
  return {
    id: booking.id,
    name: booking.name,
    email: booking.email,
    date: booking.date,
    startTime: booking.startTime,
    endTime: booking.endTime,
    sport: booking.sport,
  };
}

function validateBooking(booking) {
  const allowedSports = new Set(["pickleball", "tennis", "basketball"]);

  if (
    !booking.name ||
    !booking.email ||
    !booking.date ||
    !booking.startTime ||
    !booking.endTime ||
    !booking.sport
  ) {
    return "Name, email, date, start time, finish time, and sport are required.";
  }

  if (!isValidEmail(booking.email)) {
    return "Please enter a valid email address.";
  }

  if (!isValidDate(booking.date)) {
    return "Please enter a valid booking date.";
  }

  if (!isValidTime(booking.startTime) || !isValidTime(booking.endTime)) {
    return "Please enter valid start and finish times.";
  }

  if (booking.endTime <= booking.startTime) {
    return "Finish time must be later than the start time.";
  }

  if (!allowedSports.has(booking.sport)) {
    return "Please choose pickleball, tennis, or basketball.";
  }

  return "";
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(html);
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(message);
}

async function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;

      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function readBookingsFromFile() {
  await ensureDataFile();

  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeStoredBooking) : [];
  } catch {
    return [];
  }
}

async function writeBookingsToFile(bookings) {
  await ensureDataFile();
  await fs.writeFile(DATA_FILE, `${JSON.stringify(bookings, null, 2)}\n`, "utf8");
}

async function supabaseRequest(resource, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase request failed: ${response.status} ${detail}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function readBookingsFromSupabase() {
  const selectColumns = EMAIL_FEATURES_ENABLED
    ? "id,manage_token,name,email,date,start_time,end_time,sport"
    : "id,name,email,date,start_time,end_time,sport";
  const rows = await supabaseRequest(
    `${SUPABASE_TABLE}?select=${selectColumns}&order=date.asc,start_time.asc`
  );
  return Array.isArray(rows) ? rows.map(normalizeStoredBooking) : [];
}

function toSupabaseRow(booking) {
  const row = {
    id: booking.id,
    name: booking.name,
    email: booking.email,
    date: booking.date,
    start_time: booking.startTime,
    end_time: booking.endTime,
    sport: booking.sport,
  };

  if (EMAIL_FEATURES_ENABLED) {
    row.manage_token = booking.manageToken;
  }

  return row;
}

async function createBookingInSupabase(booking) {
  const rows = await supabaseRequest(SUPABASE_TABLE, {
    method: "POST",
    body: JSON.stringify(toSupabaseRow(booking)),
  });

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Supabase did not return the created booking.");
  }

  return normalizeStoredBooking(rows[0]);
}

async function updateBookingInSupabase(booking) {
  if (!EMAIL_FEATURES_ENABLED) {
    return null;
  }

  const rows = await supabaseRequest(
    `${SUPABASE_TABLE}?manage_token=eq.${encodeURIComponent(booking.manageToken)}`,
    {
      method: "PATCH",
      body: JSON.stringify(toSupabaseRow(booking)),
    }
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return normalizeStoredBooking(rows[0]);
}

async function deleteBookingInSupabase(bookingId) {
  const rows = await supabaseRequest(
    `${SUPABASE_TABLE}?id=eq.${encodeURIComponent(bookingId)}`,
    {
      method: "DELETE",
    }
  );

  return Array.isArray(rows) ? rows.length > 0 : false;
}

async function deleteBookingByTokenInSupabase(manageToken) {
  if (!EMAIL_FEATURES_ENABLED) {
    return [];
  }

  const rows = await supabaseRequest(
    `${SUPABASE_TABLE}?manage_token=eq.${encodeURIComponent(manageToken)}`,
    {
      method: "DELETE",
    }
  );

  return Array.isArray(rows) ? rows.map(normalizeStoredBooking) : [];
}

async function readBookings() {
  return STORAGE_MODE === "supabase"
    ? readBookingsFromSupabase()
    : readBookingsFromFile();
}

async function createBookingRecord(booking) {
  if (STORAGE_MODE === "supabase") {
    return createBookingInSupabase(booking);
  }

  const bookings = await readBookingsFromFile();
  bookings.push(booking);
  await writeBookingsToFile(bookings);
  return booking;
}

async function updateBookingRecordByToken(booking) {
  if (STORAGE_MODE === "supabase") {
    return updateBookingInSupabase(booking);
  }

  const bookings = await readBookingsFromFile();
  const index = bookings.findIndex((entry) => entry.manageToken === booking.manageToken);

  if (index === -1) {
    return null;
  }

  bookings[index] = booking;
  await writeBookingsToFile(bookings);
  return booking;
}

async function deleteBookingRecord(bookingId) {
  if (STORAGE_MODE === "supabase") {
    return deleteBookingInSupabase(bookingId);
  }

  const bookings = await readBookingsFromFile();
  const nextBookings = bookings.filter((booking) => booking.id !== bookingId);

  if (nextBookings.length === bookings.length) {
    return false;
  }

  await writeBookingsToFile(nextBookings);
  return true;
}

async function deleteBookingRecordByToken(manageToken) {
  if (STORAGE_MODE === "supabase") {
    return deleteBookingByTokenInSupabase(manageToken);
  }

  const bookings = await readBookingsFromFile();
  const deleted = bookings.filter((booking) => booking.manageToken === manageToken);
  const nextBookings = bookings.filter((booking) => booking.manageToken !== manageToken);

  if (deleted.length === 0) {
    return [];
  }

  await writeBookingsToFile(nextBookings);
  return deleted;
}

async function findBookingByToken(manageToken) {
  if (!EMAIL_FEATURES_ENABLED) {
    return null;
  }

  const bookings = await readBookings();
  return bookings.find((booking) => booking.manageToken === manageToken) || null;
}

function getBaseUrl(request) {
  if (PUBLIC_BASE_URL) {
    return PUBLIC_BASE_URL.replace(/\/$/, "");
  }

  const host = request.headers.host || `localhost:${PORT}`;
  const protocol = request.headers["x-forwarded-proto"] || "http";
  return `${protocol}://${host}`;
}

async function sendConfirmationEmail(booking, baseUrl) {
  if (!EMAIL_FEATURES_ENABLED) {
    return { sent: false, reason: "Email provider not configured." };
  }

  const cancelUrl = `${baseUrl}/manage/cancel?token=${encodeURIComponent(booking.manageToken)}`;
  const rescheduleUrl = `${baseUrl}/manage/reschedule?token=${encodeURIComponent(booking.manageToken)}`;
  const subject = `${sportLabel(booking.sport)} booking confirmed for ${booking.date}`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f1a17;">
      <h2 style="margin-bottom: 12px;">Your court booking is confirmed</h2>
      <p>Hi ${escapeHtml(booking.name)},</p>
      <p>Your ${escapeHtml(sportLabel(booking.sport))} court booking is set for <strong>${escapeHtml(
        booking.date
      )}</strong> from <strong>${escapeHtml(
        formatTimeRange(booking.startTime, booking.endTime)
      )}</strong>.</p>
      <p>If you need to make a change, use one of these links:</p>
      <p>
        <a href="${cancelUrl}" style="display:inline-block;padding:10px 16px;margin-right:8px;background:#8f2f2f;color:#fff;text-decoration:none;border-radius:999px;">Cancel Booking</a>
        <a href="${rescheduleUrl}" style="display:inline-block;padding:10px 16px;background:#d06d39;color:#fff;text-decoration:none;border-radius:999px;">Reschedule Booking</a>
      </p>
      <p>You can also copy these links:</p>
      <p>Cancel: <a href="${cancelUrl}">${cancelUrl}</a></p>
      <p>Reschedule: <a href="${rescheduleUrl}">${rescheduleUrl}</a></p>
    </div>
  `;

  const payload = {
    from: EMAIL_FROM,
    to: [booking.email],
    subject,
    html,
  };

  if (EMAIL_REPLY_TO) {
    payload.reply_to = EMAIL_REPLY_TO;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Email send failed: ${response.status} ${detail}`);
  }

  return { sent: true };
}

function renderManagePage(title, body) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        margin: 0;
        font-family: Arial, sans-serif;
        background: linear-gradient(180deg, #f8f4ea 0%, #f5efe2 100%);
        color: #27180f;
      }
      main {
        max-width: 640px;
        margin: 48px auto;
        padding: 24px;
      }
      .card {
        background: rgba(255, 253, 248, 0.96);
        border-radius: 24px;
        padding: 28px;
        box-shadow: 0 22px 50px rgba(39, 24, 15, 0.12);
      }
      .button {
        display: inline-block;
        padding: 12px 18px;
        border-radius: 999px;
        text-decoration: none;
        border: none;
        cursor: pointer;
        background: #d06d39;
        color: white;
        font: inherit;
      }
      .button.secondary {
        background: transparent;
        color: #27180f;
        border: 1px solid rgba(39, 24, 15, 0.16);
      }
      .button.danger {
        background: #8f2f2f;
      }
      .actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 18px;
      }
      dl {
        margin: 18px 0 0;
      }
      dt {
        font-weight: 700;
        margin-top: 10px;
      }
      dd {
        margin: 4px 0 0;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="card">
        ${body}
      </div>
    </main>
  </body>
</html>`;
}

function bookingSummaryHtml(booking) {
  return `
    <dl>
      <dt>Name</dt>
      <dd>${escapeHtml(booking.name)}</dd>
      <dt>Email</dt>
      <dd>${escapeHtml(booking.email)}</dd>
      <dt>Sport</dt>
      <dd>${escapeHtml(sportLabel(booking.sport))}</dd>
      <dt>Date</dt>
      <dd>${escapeHtml(booking.date)}</dd>
      <dt>Time</dt>
      <dd>${escapeHtml(formatTimeRange(booking.startTime, booking.endTime))}</dd>
    </dl>
  `;
}

async function handleManageRoutes(request, response, pathname, url) {
  if (pathname === "/manage/reschedule") {
    const token = url.searchParams.get("token") || "";
    response.writeHead(302, {
      Location: `/?reschedule=${encodeURIComponent(token)}`,
    });
    response.end();
    return true;
  }

  if (pathname !== "/manage/cancel") {
    return false;
  }

  const token = url.searchParams.get("token") || "";
  const booking = token ? await findBookingByToken(token) : null;

  if (!booking) {
    sendHtml(
      response,
      404,
      renderManagePage("Booking Not Found", "<h1>Booking not found</h1><p>This link is no longer valid.</p>")
    );
    return true;
  }

  if (request.method === "GET") {
    sendHtml(
      response,
      200,
      renderManagePage(
        "Cancel Booking",
        `
          <h1>Cancel this booking?</h1>
          <p>This will remove the booking from the shared calendar.</p>
          ${bookingSummaryHtml(booking)}
          <form method="POST" action="/manage/cancel?token=${encodeURIComponent(token)}" class="actions">
            <button class="button danger" type="submit">Yes, cancel booking</button>
            <a class="button secondary" href="/">Keep booking</a>
          </form>
        `
      )
    );
    return true;
  }

  if (request.method === "POST") {
    const deletedBookings = await deleteBookingRecordByToken(token);

    if (deletedBookings.length === 0) {
      sendHtml(
        response,
        404,
        renderManagePage("Booking Not Found", "<h1>Booking not found</h1><p>This link is no longer valid.</p>")
      );
      return true;
    }

    sendHtml(
      response,
      200,
      renderManagePage(
        "Booking Cancelled",
        `
          <h1>Booking cancelled</h1>
          <p>Your reservation has been removed from the calendar.</p>
          ${bookingSummaryHtml(deletedBookings[0])}
          <div class="actions">
            <a class="button" href="/">Book another time</a>
          </div>
        `
      )
    );
    return true;
  }

  sendText(response, 405, "Method not allowed");
  return true;
}

async function handleApi(request, response, pathname, url) {
  if (request.method === "DELETE" && pathname.startsWith("/api/bookings/")) {
    const bookingId = decodeURIComponent(pathname.slice("/api/bookings/".length));
    const deleted = await deleteBookingRecord(bookingId);

    if (!deleted) {
      sendJson(response, 404, { error: "Booking not found." });
      return;
    }

    sendJson(response, 200, { success: true });
    return;
  }

  if (request.method === "GET" && pathname === "/api/manage-booking") {
    const token = url.searchParams.get("token") || "";
    const booking = token ? await findBookingByToken(token) : null;

    if (!booking) {
      sendJson(response, 404, { error: "Booking not found." });
      return;
    }

    sendJson(response, 200, publicBooking(booking));
    return;
  }

  if (request.method === "POST" && pathname === "/api/reschedule") {
    let payload;

    try {
      const body = await readRequestBody(request);
      payload = JSON.parse(body || "{}");
    } catch {
      sendJson(response, 400, { error: "Invalid JSON body." });
      return;
    }

    const token = url.searchParams.get("token") || "";
    const existingBooking = token ? await findBookingByToken(token) : null;

    if (!existingBooking) {
      sendJson(response, 404, { error: "Booking not found." });
      return;
    }

    const nextBooking = normalizeBooking({
      ...existingBooking,
      ...payload,
      id: existingBooking.id,
      manageToken: existingBooking.manageToken,
      email: existingBooking.email,
    });

    const validationError = validateBooking(nextBooking);

    if (validationError) {
      sendJson(response, 400, { error: validationError });
      return;
    }

    const bookings = await readBookings();
    const conflict = bookings.find(
      (entry) =>
        entry.id !== existingBooking.id &&
        entry.date === nextBooking.date &&
        bookingsOverlap(nextBooking.startTime, nextBooking.endTime, entry.startTime, entry.endTime)
    );

    if (conflict) {
      sendJson(response, 409, {
        error: `${conflict.sport} is already booked for ${nextBooking.date} from ${conflict.startTime} to ${conflict.endTime}.`,
      });
      return;
    }

    const updatedBooking = await updateBookingRecordByToken(nextBooking);

    if (!updatedBooking) {
      sendJson(response, 404, { error: "Booking not found." });
      return;
    }

    sendJson(response, 200, publicBooking(updatedBooking));
    return;
  }

  if (pathname !== "/api/bookings") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (request.method === "GET") {
    const bookings = await readBookings();
    sendJson(response, 200, bookings.map(publicBooking));
    return;
  }

  if (request.method === "POST") {
    let payload;

    try {
      const body = await readRequestBody(request);
      payload = JSON.parse(body || "{}");
    } catch {
      sendJson(response, 400, { error: "Invalid JSON body." });
      return;
    }

    const booking = normalizeBooking(payload);
    const validationError = validateBooking(booking);

    if (validationError) {
      sendJson(response, 400, { error: validationError });
      return;
    }

    const bookings = await readBookings();
    const conflict = bookings.find(
      (entry) =>
        entry.date === booking.date &&
        bookingsOverlap(booking.startTime, booking.endTime, entry.startTime, entry.endTime)
    );

    if (conflict) {
      sendJson(response, 409, {
        error: `${conflict.sport} is already booked for ${booking.date} from ${conflict.startTime} to ${conflict.endTime}.`,
      });
      return;
    }

    const createdBooking = await createBookingRecord(booking);
    const baseUrl = getBaseUrl(request);
    let emailResult = { sent: false };

    try {
      emailResult = await sendConfirmationEmail(createdBooking, baseUrl);
    } catch (error) {
      emailResult = { sent: false, error: error.message };
    }

    sendJson(response, 201, {
      booking: publicBooking(createdBooking),
      emailSent: emailResult.sent,
      emailError: emailResult.error || "",
    });
    return;
  }

  sendJson(response, 405, { error: "Method not allowed." });
}

async function serveFile(response, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(data);
  } catch {
    sendText(response, 404, "Not found");
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  try {
    const handledManageRoute = await handleManageRoutes(request, response, url.pathname, url);

    if (handledManageRoute) {
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url.pathname, url);
      return;
    }

    await serveFile(response, url.pathname);
  } catch (error) {
    sendJson(response, 500, { error: "Server error", detail: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    `Sports court booking server running at http://localhost:${PORT} using ${STORAGE_MODE} storage`
  );
});