const bookingForm = document.getElementById("booking-form");
const bookingCount = document.getElementById("booking-count");
const saveStatus = document.getElementById("save-status");
const formHint = document.getElementById("form-hint") || saveStatus;
const calendarMonth = document.getElementById("calendar-month");
const calendarWeekdays = document.getElementById("calendar-weekdays");
const calendarGrid = document.getElementById("calendar-grid");
const prevMonthButton = document.getElementById("prev-month");
const nextMonthButton = document.getElementById("next-month");

const nameInput = document.getElementById("name");
const emailInput = document.getElementById("email");
const dateInput = document.getElementById("date");
const startTimeInput = document.getElementById("start-time");
const endTimeInput = document.getElementById("end-time");
const sportInput = document.getElementById("sport");

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const API_URL = "/api/bookings";
const MANAGE_BOOKING_API_URL = "/api/manage-booking";
const RESCHEDULE_API_URL = "/api/reschedule";
const REFRESH_INTERVAL_MS = 15000;
const SERVER_URL = "http://localhost:3000";
let currentMonth = startOfMonth(new Date());
let bookingsCache = [];
let rescheduleToken = "";

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

async function loadBookings() {
  const response = await fetch(API_URL, { cache: "no-store" });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || payload.error || "Unable to load bookings right now.");
  }

  const bookings = await response.json();
  return Array.isArray(bookings) ? bookings : [];
}

async function loadManagedBooking(token) {
  const response = await fetch(`${MANAGE_BOOKING_API_URL}?token=${encodeURIComponent(token)}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Unable to load that booking.");
  }

  return response.json();
}

function setHint(message, isError = false) {
  if (!formHint) {
    return;
  }

  formHint.textContent = message;
  formHint.classList.toggle("error", isError);
}

function formatMonth(date) {
  return date.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sportLabel(sport) {
  return sport.charAt(0).toUpperCase() + sport.slice(1);
}

function formatTime(time) {
  const [hourText = "0", minute = "00"] = time.split(":");
  const hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

function addOneHour(time) {
  const [hourText = "0", minuteText = "00"] = time.split(":");
  const totalMinutes = Number(hourText) * 60 + Number(minuteText) + 60;
  const wrappedMinutes = totalMinutes % (24 * 60);
  const hour = String(Math.floor(wrappedMinutes / 60)).padStart(2, "0");
  const minute = String(wrappedMinutes % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

function getBookingStart(booking) {
  return booking.startTime || booking.time || "";
}

function getBookingEnd(booking) {
  if (booking.endTime) {
    return booking.endTime;
  }

  if (booking.time) {
    return addOneHour(booking.time);
  }

  return "";
}

function formatTimeRange(startTime, endTime) {
  return `${formatTime(startTime)} - ${formatTime(endTime)}`;
}

function bookingsOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
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

function bookingDetails(booking) {
  const startTime = getBookingStart(booking);
  const endTime = getBookingEnd(booking);

  return [
    `${sportLabel(booking.sport)}`,
    `Name: ${booking.name}`,
    `Email: ${booking.email}`,
    `Date: ${booking.date}`,
    `Time: ${formatTimeRange(startTime, endTime)}`,
  ].join("\n");
}

function showOverlapPopup(message) {
  window.alert(message);
}

function clearRescheduleMode() {
  rescheduleToken = "";
  const url = new URL(window.location.href);
  url.searchParams.delete("reschedule");
  window.history.replaceState({}, "", url);
}

function buildWeekdays() {
  calendarWeekdays.innerHTML = "";

  WEEKDAYS.forEach((day) => {
    const el = document.createElement("div");
    el.className = "weekday";
    el.textContent = day;
    calendarWeekdays.appendChild(el);
  });
}

function renderCalendar(bookings) {
  calendarMonth.textContent = formatMonth(currentMonth);
  calendarGrid.innerHTML = "";

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();
  const totalDays = lastDay.getDate();
  const totalCells = Math.ceil((startOffset + totalDays) / 7) * 7;
  const todayKey = formatDateKey(new Date());

  for (let cellIndex = 0; cellIndex < totalCells; cellIndex += 1) {
    const dayNumber = cellIndex - startOffset + 1;
    const cellDate = new Date(year, month, dayNumber);
    const cellKey = formatDateKey(cellDate);
    const dayBookings = bookings.filter((booking) => booking.date === cellKey);

    const dayCell = document.createElement("article");
    dayCell.className = "calendar-day";

    if (cellDate.getMonth() !== month) {
      dayCell.classList.add("is-other-month");
    }

    if (cellKey === todayKey) {
      dayCell.classList.add("is-today");
    }

    const dayNumberEl = document.createElement("div");
    dayNumberEl.className = "calendar-day-number";
    dayNumberEl.textContent = String(cellDate.getDate());

    const bookingsEl = document.createElement("div");
    bookingsEl.className = "calendar-bookings";

    if (dayBookings.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "calendar-empty";
      emptyEl.textContent = "No bookings";
      bookingsEl.appendChild(emptyEl);
    } else {
      dayBookings.forEach((booking) => {
        const startTime = getBookingStart(booking);
        const endTime = getBookingEnd(booking);
        const bookingEl = document.createElement("div");
        bookingEl.className = `calendar-booking ${booking.sport}`;
        const details = bookingDetails(booking);
        bookingEl.dataset.tooltip = details;
        bookingEl.setAttribute("title", details);
        bookingEl.setAttribute("tabindex", "0");
        bookingEl.innerHTML = `
          <div class="calendar-booking__summary">
            <strong>${sportLabel(booking.sport)}</strong>
            <span class="calendar-booking-time">${formatTimeRange(startTime, endTime)}</span>
          </div>
          <span class="calendar-booking-name">${escapeHtml(booking.name)}</span>
        `;
        bookingsEl.appendChild(bookingEl);
      });
    }

    dayCell.append(dayNumberEl, bookingsEl);
    calendarGrid.appendChild(dayCell);
  }
}

function render() {
  const bookings = [...bookingsCache].sort((a, b) => {
    const dateComparison = a.date.localeCompare(b.date);
    if (dateComparison !== 0) {
      return dateComparison;
    }

    return getBookingStart(a).localeCompare(getBookingStart(b));
  });
  bookingCount.textContent = String(bookings.length);
  saveStatus.textContent = rescheduleToken
    ? "Reschedule mode: update the form and save your new time."
    : `${bookings.length} booking${bookings.length === 1 ? "" : "s"} shared across browsers.`;
  renderCalendar(bookings);
}

async function refreshBookings(options = {}) {
  const { showError = false } = options;

  try {
    bookingsCache = await loadBookings();
    render();
  } catch (error) {
    render();

    if (showError) {
      const openedAsFile = window.location.protocol === "file:";
      const message = openedAsFile
        ? `Open this app from ${SERVER_URL}, not as a file, so shared bookings can load and save.`
        : error.message || "We couldn't connect to the booking service right now. Please try again in a moment.";
      setHint(message, true);
    }

    saveStatus.textContent = "Booking service is temporarily unavailable.";
  }
}

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const date = dateInput.value;
  const startTime = startTimeInput.value;
  const endTime = endTimeInput.value;
  const sport = sportInput.value;

  if (!name || !email || !date || !startTime || !endTime || !sport) {
    setHint("Please enter your name, email, date, start time, finish time, and sport.", true);
    return;
  }

  if (endTime <= startTime) {
    setHint("Finish time must be later than the start time.", true);
    return;
  }

  const overlappingBooking = bookingsCache.find(
    (booking) =>
      booking.date === date &&
      bookingsOverlap(startTime, endTime, getBookingStart(booking), getBookingEnd(booking))
  );

  if (overlappingBooking) {
    showOverlapPopup(
      `${sportLabel(overlappingBooking.sport)} is already booked on ${date} from ${formatTimeRange(
        getBookingStart(overlappingBooking),
        getBookingEnd(overlappingBooking)
      )} by ${overlappingBooking.name}.`
    );
    setHint("That time is already booked.", true);
    return;
  }

  try {
    const endpoint = rescheduleToken
      ? `${RESCHEDULE_API_URL}?token=${encodeURIComponent(rescheduleToken)}`
      : API_URL;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        email,
        date,
        startTime,
        endTime,
        sport,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 409 && payload.error) {
        showOverlapPopup(payload.error);
      }

      setHint(payload.error || "Unable to save the booking.", true);
      await refreshBookings();
      return;
    }

    const booking = payload.booking || payload;
    currentMonth = startOfMonth(new Date(`${date}T12:00:00`));
    bookingForm.reset();
    dateInput.value = booking.date || date;
    startTimeInput.value = booking.startTime || startTime;
    endTimeInput.value = booking.endTime || endTime;
    sportInput.selectedIndex = 0;
    if (rescheduleToken) {
      clearRescheduleMode();
      setHint("Booking rescheduled successfully.");
    } else if (payload.emailSent) {
      setHint("Booking saved and confirmation email sent.");
    } else if (payload.emailError) {
      setHint("Booking saved, but the confirmation email could not be sent.", true);
    } else {
      setHint("Booking saved. It now appears on the shared calendar below.");
    }
    await refreshBookings();
  } catch {
    setHint("We couldn't save your booking right now. Please try again in a moment.", true);
  }
});

prevMonthButton.addEventListener("click", () => {
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
  render();
});

nextMonthButton.addEventListener("click", () => {
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
  render();
});

async function init() {
  const url = new URL(window.location.href);
  rescheduleToken = url.searchParams.get("reschedule") || "";
  const today = formatDateKey(new Date());
  dateInput.value = today;
  startTimeInput.value = "09:00";
  endTimeInput.value = "10:00";
  buildWeekdays();
  render();
  setHint(`Bookings are saved on the server and shared across browsers at ${SERVER_URL}.`);

  if (rescheduleToken) {
    try {
      const managedBooking = await loadManagedBooking(rescheduleToken);
      nameInput.value = managedBooking.name || "";
      emailInput.value = managedBooking.email || "";
      dateInput.value = managedBooking.date || today;
      startTimeInput.value = managedBooking.startTime || "09:00";
      endTimeInput.value = managedBooking.endTime || "10:00";
      sportInput.value = managedBooking.sport || "";
      currentMonth = startOfMonth(new Date(`${managedBooking.date}T12:00:00`));
      setHint("You are rescheduling an existing booking. Update the form and click Book Court.");
    } catch (error) {
      clearRescheduleMode();
      setHint(error.message, true);
    }
  }

  await refreshBookings({ showError: true });

  window.setInterval(() => {
    refreshBookings();
  }, REFRESH_INTERVAL_MS);

  window.addEventListener("focus", () => {
    refreshBookings();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshBookings();
    }
  });
}

init();