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

  return {
    id: typeof input.id === "string" && input.id.trim() ? input.id.trim() : randomUUID(),
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
  const rows = await supabaseRequest(
    `${SUPABASE_TABLE}?select=id,name,email,date,start_time,end_time,sport&order=date.asc,start_time.asc`
  );
  return Array.isArray(rows) ? rows.map(normalizeStoredBooking) : [];
}

function toSupabaseRow(booking) {
  return {
    id: booking.id,
    name: booking.name,
    email: booking.email,
    date: booking.date,
    start_time: booking.startTime,
    end_time: booking.endTime,
    sport: booking.sport,
  };
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

async function deleteBookingInSupabase(bookingId) {
  const rows = await supabaseRequest(
    `${SUPABASE_TABLE}?id=eq.${encodeURIComponent(bookingId)}`,
    {
      method: "DELETE",
    }
  );

  return Array.isArray(rows) ? rows.length > 0 : false;
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

async function handleApi(request, response, pathname) {
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

  if (pathname !== "/api/bookings") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (request.method === "GET") {
    const bookings = await readBookings();
    sendJson(response, 200, bookings);
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
    sendJson(response, 201, createdBooking);
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
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url.pathname);
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
