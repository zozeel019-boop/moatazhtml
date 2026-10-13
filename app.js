const STORAGE_KEY = "nozol-hotel-manager-v1";
const backendConfig = window.NEON_STAY_CONFIG || {};
const backendRequested = Boolean(backendConfig.supabaseUrl || backendConfig.supabaseAnonKey);

const roomCatalog = [
  { id: "101", type: "مفردة", floor: 1, price: 280, capacity: 1 },
  { id: "102", type: "مزدوجة", floor: 1, price: 420, capacity: 2 },
  { id: "103", type: "ديلوكس", floor: 1, price: 650, capacity: 2 },
  { id: "104", type: "مزدوجة", floor: 1, price: 420, capacity: 2 },
  { id: "201", type: "مفردة", floor: 2, price: 280, capacity: 1 },
  { id: "202", type: "ديلوكس", floor: 2, price: 650, capacity: 2 },
  { id: "203", type: "جناح", floor: 2, price: 950, capacity: 4 },
  { id: "204", type: "مزدوجة", floor: 2, price: 420, capacity: 2 },
  { id: "301", type: "ديلوكس", floor: 3, price: 650, capacity: 2 },
  { id: "302", type: "جناح", floor: 3, price: 950, capacity: 4 },
  { id: "303", type: "مزدوجة", floor: 3, price: 420, capacity: 2 },
  { id: "304", type: "مفردة", floor: 3, price: 280, capacity: 1 },
];

const today = new Date();
today.setHours(0, 0, 0, 0);

function dateOffset(offset) {
  const date = new Date(today);
  date.setDate(date.getDate() + offset);
  return formatInputDate(date);
}

function formatInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createInitialState() {
  return {
    bookings: [
      { id: "NZ-2048", guestName: "سارة العتيبي", phone: "050 234 5678", email: "sara@example.com", roomId: "203", roomType: "جناح", guests: 2, checkIn: dateOffset(0), checkOut: dateOffset(3), amount: 2850, status: "checked-in" },
      { id: "NZ-2047", guestName: "خالد الحربي", phone: "055 876 1234", email: "khaled@example.com", roomId: "103", roomType: "ديلوكس", guests: 2, checkIn: dateOffset(0), checkOut: dateOffset(2), amount: 1300, status: "checked-in" },
      { id: "NZ-2046", guestName: "نورة القحطاني", phone: "053 447 8901", email: "noura@example.com", roomId: "102", roomType: "مزدوجة", guests: 2, checkIn: dateOffset(0), checkOut: dateOffset(1), amount: 420, status: "confirmed" },
      { id: "NZ-2045", guestName: "محمد الدوسري", phone: "056 110 2450", email: "mohammed@example.com", roomId: "302", roomType: "جناح", guests: 3, checkIn: dateOffset(1), checkOut: dateOffset(4), amount: 2850, status: "confirmed" },
      { id: "NZ-2044", guestName: "ريم الشهري", phone: "054 600 7788", email: "reem@example.com", roomId: "201", roomType: "مفردة", guests: 1, checkIn: dateOffset(-3), checkOut: dateOffset(-1), amount: 560, status: "completed" },
    ],
    maintenanceRooms: ["304"],
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return createInitialState();
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed.bookings) || !Array.isArray(parsed.maintenanceRooms)) {
      throw new Error("بيانات الفندق المحفوظة غير صالحة.");
    }
    return parsed;
  } catch (error) {
    console.error("تعذر تحميل بيانات الفندق المحفوظة:", error);
    return createInitialState();
  }
}

let state = backendRequested ? { bookings: [], maintenanceRooms: [] } : loadState();
let currentPage = "dashboard";
let globalQuery = "";
let bookingStatusFilter = "all";
let toastTimer;
let supabaseClient = null;
let authSession = null;
let authMode = "signin";
let realtimeChannel = null;
let loadingUserId = null;

const pageContent = document.querySelector("#page-content");
const modalBackdrop = document.querySelector("#modal-backdrop");
const bookingForm = document.querySelector("#booking-form");
const statusLabels = {
  confirmed: "مؤكد",
  "checked-in": "تم تسجيل الدخول",
  completed: "مكتمل",
  cancelled: "ملغي",
};

function showAuthError(message) {
  const errorElement = document.querySelector("#auth-error");
  errorElement.textContent = message;
  errorElement.classList.remove("auth-success");
  errorElement.hidden = false;
}

function showAuthMessage(message) {
  const messageElement = document.querySelector("#auth-error");
  messageElement.textContent = message;
  messageElement.classList.add("auth-success");
  messageElement.hidden = false;
}

function clearAuthError() {
  const errorElement = document.querySelector("#auth-error");
  errorElement.textContent = "";
  errorElement.classList.remove("auth-success");
  errorElement.hidden = true;
}

function setAuthMode(mode) {
  authMode = mode;
  clearAuthError();
  const isSignUp = mode === "signup";
  document.querySelector("#auth-title").textContent = isSignUp ? "إنشاء حساب مدير" : "تسجيل الدخول";
  document.querySelector("#auth-description").textContent = isSignUp
    ? "أنشئ حسابًا لبدء إعداد مساحة الفندق الخاصة بك."
    : "سجل الدخول للوصول إلى بيانات الفندق المحفوظة بأمان.";
  document.querySelector("#auth-submit").textContent = isSignUp ? "إنشاء الحساب" : "دخول آمن";
  document.querySelector("#auth-toggle").textContent = isSignUp ? "لديك حساب؟ تسجيل الدخول" : "إنشاء حساب مدير جديد";
  document.querySelector("#auth-form [name='password']").autocomplete = isSignUp ? "new-password" : "current-password";
}

function setCloudMode(isCloud, user = null) {
  const name = document.querySelector("#profile-name");
  const status = document.querySelector("#profile-status");
  name.textContent = isCloud ? (user?.email || "مدير الفندق") : "وضع محلي";
  status.textContent = isCloud ? "متصل بقاعدة البيانات" : "البيانات على هذا الجهاز";
  status.classList.toggle("cloud-active", isCloud);
  status.classList.toggle("local-mode", !isCloud);
}

function toBookingRecord(booking, userId) {
  return {
    user_id: userId,
    booking_code: booking.id,
    guest_name: booking.guestName,
    phone: booking.phone,
    email: booking.email || null,
    room_id: booking.roomId,
    room_type: booking.roomType,
    guests: booking.guests,
    check_in: booking.checkIn,
    check_out: booking.checkOut,
    amount: booking.amount,
    status: booking.status,
  };
}

function fromBookingRecord(record) {
  return {
    id: record.booking_code,
    guestName: record.guest_name,
    phone: record.phone,
    email: record.email || "",
    roomId: record.room_id,
    roomType: record.room_type,
    guests: record.guests,
    checkIn: record.check_in,
    checkOut: record.check_out,
    amount: Number(record.amount),
    status: record.status,
  };
}

async function loadCloudState(session) {
  const userId = session.user.id;
  const [bookingsResult, maintenanceResult] = await Promise.all([
    supabaseClient.from("bookings").select("*").order("check_in", { ascending: true }),
    supabaseClient.from("room_maintenance").select("room_id"),
  ]);
  if (bookingsResult.error) throw bookingsResult.error;
  if (maintenanceResult.error) throw maintenanceResult.error;
  if (authSession?.user.id !== userId) return;
  state = {
    bookings: bookingsResult.data.map(fromBookingRecord),
    maintenanceRooms: maintenanceResult.data.map((room) => room.room_id),
  };
  loadingUserId = null;
  setCloudMode(true, session.user);
  document.querySelector("#auth-screen").hidden = true;
  render();
}

function startRealtimeUpdates(userId) {
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel = supabaseClient.channel(`hotel-data-${userId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: `user_id=eq.${userId}` }, () => {
      if (authSession?.user.id === userId) loadCloudState(authSession).catch(handleRealtimeLoadError);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "room_maintenance", filter: `user_id=eq.${userId}` }, () => {
      if (authSession?.user.id === userId) loadCloudState(authSession).catch(handleRealtimeLoadError);
    })
    .subscribe((status, error) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("تعذر تفعيل التحديثات الفورية من Supabase:", error || status);
        showToast("تعذر تفعيل التحديثات الفورية. ستظهر البيانات بعد إعادة تحميل الصفحة.");
      }
    });
}

function handleCloudLoadError(error) {
  console.error("تعذر تحميل بيانات الفندق من Supabase:", error);
  showAuthError(`تعذر تحميل بيانات الفندق: ${error.message || "تحقق من إعداد الجداول وسياسات الوصول في Supabase."}`);
  document.querySelector("#auth-screen").hidden = false;
}

function handleRealtimeLoadError(error) {
  console.error("تعذر تحديث بيانات الفندق من Supabase:", error);
  showToast(`تعذر تحديث البيانات: ${error.message || "ستُعاد المحاولة عند حدوث تحديث جديد."}`);
}

async function applyAuthSession(session) {
  authSession = session;
  if (!session) {
    loadingUserId = null;
    state = { bookings: [], maintenanceRooms: [] };
    setAuthMode("signin");
    if (realtimeChannel) {
      await supabaseClient.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    setCloudMode(true);
    document.querySelector("#auth-screen").hidden = false;
    render();
    return;
  }
  if (loadingUserId === session.user.id) return;
  loadingUserId = session.user.id;
  clearAuthError();
  document.querySelector("#auth-screen").hidden = true;
  startRealtimeUpdates(session.user.id);
  try {
    await loadCloudState(session);
  } catch (error) {
    loadingUserId = null;
    handleCloudLoadError(error);
  }
}

async function initializeApp() {
  if (!backendRequested) {
    setCloudMode(false);
    render();
    return;
  }
  document.querySelector("#auth-screen").hidden = false;
  render();
  if (!backendConfig.supabaseUrl || !backendConfig.supabaseAnonKey) {
    showAuthError("أضف رابط Supabase والمفتاح العام في ملف config.js لإكمال الاتصال.");
    return;
  }
  if (!window.supabase?.createClient) {
    showAuthError("تعذر تحميل مكتبة Supabase. تحقق من اتصال الإنترنت ثم أعد تحميل الصفحة.");
    return;
  }
  try {
    supabaseClient = window.supabase.createClient(backendConfig.supabaseUrl, backendConfig.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    supabaseClient.auth.onAuthStateChange((_event, session) => {
      void applyAuthSession(session).catch(handleCloudLoadError);
    });
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (data.session) await applyAuthSession(data.session);
    else setAuthMode("signin");
  } catch (error) {
    console.error("تعذر تهيئة اتصال Supabase:", error);
    showAuthError(`تعذر الاتصال بـ Supabase: ${error.message || "تحقق من الرابط والمفتاح."}`);
  }
}

function persistState() {
  if (supabaseClient) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("تعذر حفظ بيانات الفندق:", error);
    showToast("تعذر حفظ البيانات. تحقق من مساحة التخزين في المتصفح.");
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function formatCurrency(value) {
  return `${Number(value || 0).toLocaleString("ar-SA")} ر.س`;
}

function formatDate(value, options = { day: "numeric", month: "short" }) {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("ar-SA", options).format(date);
}

function relativeDateLabel(value) {
  if (value === dateOffset(0)) return "اليوم";
  if (value === dateOffset(1)) return "غدًا";
  return formatDate(value);
}

function statusPill(status) {
  const classes = {
    confirmed: "status-confirmed",
    "checked-in": "status-checked-in",
    completed: "status-completed",
    cancelled: "status-cancelled",
  };
  return `<span class="status-pill ${classes[status] || "status-pending"}">${statusLabels[status] || "بانتظار التأكيد"}</span>`;
}

function matchingBookings() {
  const query = globalQuery.trim().toLocaleLowerCase("ar");
  return state.bookings.filter((booking) => {
    const matchesQuery = !query || [booking.guestName, booking.phone, booking.id, booking.roomId]
      .some((item) => String(item).toLocaleLowerCase("ar").includes(query));
    const matchesStatus = bookingStatusFilter === "all" || booking.status === bookingStatusFilter;
    return matchesQuery && matchesStatus;
  });
}

function activeBookings() {
  return state.bookings.filter((booking) => ["confirmed", "checked-in"].includes(booking.status));
}

function bookingRoomState(roomId) {
  if (state.maintenanceRooms.includes(roomId)) return "maintenance";
  const occupied = state.bookings.some((booking) => booking.roomId === roomId && booking.status === "checked-in");
  if (occupied) return "occupied";
  const reserved = state.bookings.some((booking) => booking.roomId === roomId && booking.status === "confirmed"
    && booking.checkIn <= formatInputDate(today) && booking.checkOut > formatInputDate(today));
  return reserved ? "reserved" : "available";
}

function roomStatusMarkup(status) {
  const label = { available: "متاحة", occupied: "مشغولة", reserved: "محجوزة اليوم", maintenance: "صيانة" }[status];
  return `<span class="room-status ${status === "reserved" ? "occupied" : status}">${label}</span>`;
}

function initials(name) {
  return String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("");
}

function guestAvatar(name, extraClass = "") {
  return `<span class="avatar ${extraClass}">${escapeHtml(initials(name))}</span>`;
}

function roomIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20v-9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9M3 15h18M6 9V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3M3 20v1M21 20v1" /></svg>`;
}

function bookingRows(bookings, limit = Infinity, includeActions = true, compact = false) {
  const visible = bookings.slice(0, limit);
  if (!visible.length) {
    return `<tr><td colspan="${compact ? 5 : includeActions ? 7 : 6}"><div class="empty-state"><strong>لا توجد حجوزات هنا بعد</strong>أضف حجزًا جديدًا لبدء إدارة إقامات الفندق.</div></td></tr>`;
  }
  return visible.map((booking) => {
    const action = booking.status === "confirmed"
      ? `<button class="action-button" data-action="check-in" data-id="${escapeHtml(booking.id)}">تسجيل الدخول</button>`
      : booking.status === "checked-in"
        ? `<button class="action-button" data-action="check-out" data-id="${escapeHtml(booking.id)}">تسجيل المغادرة</button>`
        : `<button class="action-button danger" data-action="delete" data-id="${escapeHtml(booking.id)}" aria-label="حذف الحجز">حذف</button>`;
    return `<tr>
      <td class="room-number">${escapeHtml(booking.id)}</td>
      <td><span class="guest-cell">${guestAvatar(booking.guestName)}<span>${escapeHtml(booking.guestName)}</span></span></td>
      <td>${escapeHtml(booking.roomId)} <span class="muted-inline">· ${escapeHtml(booking.roomType)}</span></td>
      <td>${formatDate(booking.checkIn)} <span class="muted-inline">—</span> ${formatDate(booking.checkOut)}</td>
      ${compact ? "" : `<td>${formatCurrency(booking.amount)}</td>`}
      <td>${statusPill(booking.status)}</td>
      ${includeActions && !compact ? `<td><span class="table-actions">${action}</span></td>` : ""}
    </tr>`;
  }).join("");
}

function renderDashboard() {
  const active = activeBookings();
  const occupiedCount = roomCatalog.filter((room) => ["occupied", "reserved"].includes(bookingRoomState(room.id))).length;
  const occupancy = Math.round((occupiedCount / roomCatalog.length) * 100);
  const arrivals = state.bookings.filter((booking) => booking.checkIn === formatInputDate(today) && booking.status === "confirmed").length;
  const revenue = state.bookings.filter((booking) => booking.status !== "cancelled" && booking.checkIn.slice(0, 7) === formatInputDate(today).slice(0, 7))
    .reduce((sum, booking) => sum + Number(booking.amount || 0), 0);
  const recent = [...state.bookings].sort((a, b) => b.checkIn.localeCompare(a.checkIn));
  const weekValues = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(today);
    day.setDate(day.getDate() - (6 - index));
    const key = formatInputDate(day);
    return state.bookings.filter((booking) => booking.checkIn === key && booking.status !== "cancelled")
      .reduce((sum, booking) => sum + Number(booking.amount || 0), 0);
  });
  const maxRevenue = Math.max(...weekValues, 1);
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(today);
    day.setDate(day.getDate() - (6 - index));
    return new Intl.DateTimeFormat("ar-SA", { weekday: "short" }).format(day);
  });

  pageContent.innerHTML = `
    <div class="page-heading">
      <div><h1>لوحة التحكم</h1><p>نظرة سريعة على أداء فندقك وحالة الإقامة اليوم.</p></div>
      <button class="button button-primary" data-action="new-booking"><span>+</span> حجز جديد</button>
    </div>
    <section class="welcome-banner">
      <div class="welcome-copy"><span class="eyebrow">مرحبًا بعودتك 👋</span><h2>إدارة أسهل، وضيافة أفضل</h2><p>لديك <strong>${arrivals.toLocaleString("ar-SA")} حجوزات وصول</strong> اليوم. نتمنى لضيوفك إقامة سعيدة!</p></div>
      <div class="welcome-illustration">${roomIcon()}</div>
    </section>
    <section class="stats-grid" aria-label="إحصائيات الفندق">
      <article class="stat-card"><div class="stat-top"><span class="stat-label">إجمالي الحجوزات النشطة</span><span class="stat-icon tone-purple"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg></span></div><div class="stat-value">${active.length.toLocaleString("ar-SA")} <small>حجز</small></div><div class="stat-foot"><span class="trend">●</span> تشمل الحجوزات المؤكدة والنزلاء الحاليين</div></article>
      <article class="stat-card"><div class="stat-top"><span class="stat-label">الغرف المشغولة والمحجوزة</span><span class="stat-icon tone-green"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20v-9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9M3 15h18M6 9V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3"/></svg></span></div><div class="stat-value">${occupiedCount.toLocaleString("ar-SA")} <small>من ${roomCatalog.length.toLocaleString("ar-SA")} غرفة</small></div><div class="stat-foot"><span class="trend">${occupancy.toLocaleString("ar-SA")}٪</span> نسبة الإشغال اليوم</div></article>
      <article class="stat-card"><div class="stat-top"><span class="stat-label">إيرادات هذا الشهر</span><span class="stat-icon tone-orange"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></span></div><div class="stat-value">${revenue.toLocaleString("ar-SA")} <small>ر.س</small></div><div class="stat-foot">إجمالي قيمة الحجوزات المسجلة هذا الشهر</div></article>
      <article class="stat-card"><div class="stat-top"><span class="stat-label">حجوزات الوصول اليوم</span><span class="stat-icon tone-blue"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6M19 5v14"/></svg></span></div><div class="stat-value">${arrivals.toLocaleString("ar-SA")} <small>نزيل</small></div><div class="stat-foot">من المتوقع وصولهم اليوم</div></article>
    </section>
    <section class="content-grid">
      <article class="panel">
        <div class="panel-header"><div><h2 class="panel-heading">أحدث الحجوزات</h2><p class="panel-subtitle">آخر الإقامات المسجلة في النظام</p></div><button class="text-link" data-page="bookings">عرض جميع الحجوزات ←</button></div>
        <div class="table-wrap dashboard-table"><table><thead><tr><th>رقم الحجز</th><th>النزيل</th><th>الغرفة</th><th>الإقامة</th><th>الحالة</th></tr></thead><tbody>${bookingRows(recent, 4, false, true)}</tbody></table></div>
      </article>
      <div class="side-stack">
        <article class="panel occupancy-panel">
          <div class="panel-header"><div><h2 class="panel-heading">إشغال الغرف</h2><p class="panel-subtitle">حالة الغرف في الفندق اليوم</p></div></div>
          <div class="occupancy-content"><div class="donut" style="--occupancy:${occupancy}%"><div class="donut-center"><strong>${occupancy.toLocaleString("ar-SA")}٪</strong><small>نسبة الإشغال</small></div></div>
            <div class="legend"><div class="legend-row"><i class="legend-dot"></i> مشغولة / محجوزة <strong>${occupiedCount.toLocaleString("ar-SA")}</strong></div><div class="legend-row"><i class="legend-dot available"></i> متاحة <strong>${(roomCatalog.length - occupiedCount - state.maintenanceRooms.length).toLocaleString("ar-SA")}</strong></div><div class="legend-row"><i class="legend-dot maintenance"></i> صيانة <strong>${state.maintenanceRooms.length.toLocaleString("ar-SA")}</strong></div></div>
          </div>
        </article>
        <article class="panel revenue-panel">
          <div class="panel-header"><div><h2 class="panel-heading">ملخص الإيرادات</h2><p class="panel-subtitle">إيرادات الحجوزات خلال آخر ٧ أيام</p></div><span class="stat-icon tone-purple"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></span></div>
          <div class="revenue-summary"><strong>${weekValues.reduce((sum, value) => sum + value, 0).toLocaleString("ar-SA")}</strong><span>ر.س هذا الأسبوع</span></div>
          <div class="chart" aria-label="رسم بياني لإيرادات الأسبوع">${weekValues.map((value, index) => `<div class="chart-column" title="${escapeHtml(formatCurrency(value))}"><div class="chart-bar ${index === 6 ? "current" : ""}" style="height:${Math.max(9, Math.round(value / maxRevenue * 100))}%"></div></div>`).join("")}</div>
          <div class="chart-labels">${days.map((day) => `<span>${escapeHtml(day)}</span>`).join("")}</div>
        </article>
      </div>
    </section>`;
}

function renderBookings() {
  const bookings = matchingBookings();
  pageContent.innerHTML = `
    <div class="page-heading"><div><h1>الحجوزات</h1><p>إدارة حجوزات النزلاء ومتابعة الدخول والمغادرة.</p></div><button class="button button-primary" data-action="new-booking"><span>+</span> إضافة حجز</button></div>
    <div class="toolbar"><div class="toolbar-group"><select class="filter-select" id="booking-status-filter" aria-label="تصفية حسب الحالة"><option value="all">كل الحالات</option><option value="confirmed">مؤكد</option><option value="checked-in">تم تسجيل الدخول</option><option value="completed">مكتمل</option><option value="cancelled">ملغي</option></select><span class="muted-inline">${bookings.length.toLocaleString("ar-SA")} حجز</span></div><input class="toolbar-search" id="booking-search" type="search" placeholder="ابحث بالاسم أو رقم الحجز..." value="${escapeHtml(globalQuery)}" aria-label="البحث في الحجوزات" /></div>
    <section class="panel section-panel"><div class="table-wrap"><table><thead><tr><th>رقم الحجز</th><th>النزيل</th><th>الغرفة</th><th>الإقامة</th><th>المبلغ</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>${bookingRows(bookings)}</tbody></table></div></section>
    <div class="section-note"><span>i</span> استخدم «تسجيل الدخول» عند وصول النزيل و«تسجيل المغادرة» عند انتهاء إقامته لتحديث حالة الغرفة.</div>`;
  document.querySelector("#booking-status-filter").value = bookingStatusFilter;
}

function renderRooms() {
  const query = globalQuery.trim().toLocaleLowerCase("ar");
  const rooms = roomCatalog.filter((room) => `${room.id} ${room.type}`.toLocaleLowerCase("ar").includes(query));
  const counts = { available: 0, occupied: 0, reserved: 0, maintenance: 0 };
  for (const room of roomCatalog) counts[bookingRoomState(room.id)] += 1;
  pageContent.innerHTML = `
    <div class="page-heading"><div><h1>الغرف</h1><p>تابع حالة الغرف وتوفرها في جميع طوابق الفندق.</p></div></div>
    <div class="toolbar"><div class="toolbar-group">${Object.entries({ available: "متاحة", occupied: "مشغولة", reserved: "محجوزة", maintenance: "صيانة" }).map(([key, label]) => `<span class="status-pill ${key === "available" ? "status-checked-in" : key === "maintenance" ? "status-pending" : key === "reserved" ? "status-confirmed" : "status-completed"}">${label}: ${counts[key].toLocaleString("ar-SA")}</span>`).join("")}</div><input class="toolbar-search" id="room-search" type="search" placeholder="ابحث برقم الغرفة أو نوعها..." value="${escapeHtml(globalQuery)}" aria-label="البحث في الغرف" /></div>
    <section class="room-grid">${rooms.length ? rooms.map((room) => {
      const status = bookingRoomState(room.id);
      return `<article class="room-card"><div class="room-card-top"><div><h3>غرفة ${escapeHtml(room.id)}</h3><span class="room-type">غرفة ${escapeHtml(room.type)}</span></div><span class="room-illustration">${roomIcon()}</span></div><div class="room-card-meta"><span>الطابق <strong>${room.floor.toLocaleString("ar-SA")}</strong></span><span>السعة <strong>${room.capacity.toLocaleString("ar-SA")} ${room.capacity === 1 ? "نزيل" : "نزلاء"}</strong></span><span>لليلة <strong>${room.price.toLocaleString("ar-SA")} ر.س</strong></span></div><div class="room-card-footer">${roomStatusMarkup(status)}<button class="text-link" data-action="toggle-maintenance" data-id="${escapeHtml(room.id)}">${status === "maintenance" ? "إنهاء الصيانة" : "تحديث الصيانة"}</button></div></article>`;
    }).join("") : `<div class="panel empty-state">لا توجد غرف تطابق البحث.</div>`}</section>`;
}

function renderGuests() {
  const query = globalQuery.trim().toLocaleLowerCase("ar");
  const guestMap = new Map();
  for (const booking of state.bookings) {
    const key = booking.phone || booking.guestName;
    const guest = guestMap.get(key) || { name: booking.guestName, phone: booking.phone, email: booking.email, stays: 0, total: 0, lastStay: booking.checkIn };
    if (booking.status !== "cancelled") guest.stays += 1;
    guest.total += Number(booking.amount || 0);
    if (booking.checkIn > guest.lastStay) guest.lastStay = booking.checkIn;
    guestMap.set(key, guest);
  }
  const guests = [...guestMap.values()].filter((guest) => [guest.name, guest.phone, guest.email || ""].some((item) => item.toLocaleLowerCase("ar").includes(query)));
  pageContent.innerHTML = `
    <div class="page-heading"><div><h1>النزلاء</h1><p>قاعدة بيانات ضيوف الفندق وسجل إقاماتهم.</p></div></div>
    <div class="toolbar"><span class="muted-inline">${guests.length.toLocaleString("ar-SA")} نزيل مسجل</span><input class="toolbar-search" id="guest-search" type="search" placeholder="ابحث بالاسم أو رقم الجوال..." value="${escapeHtml(globalQuery)}" aria-label="البحث في النزلاء" /></div>
    <section class="guest-list">${guests.length ? guests.map((guest) => `<article class="guest-card">${guestAvatar(guest.name)}<div class="guest-info"><strong>${escapeHtml(guest.name)}</strong><small>${escapeHtml(guest.phone || "لا يوجد رقم جوال")}${guest.email ? ` · ${escapeHtml(guest.email)}` : ""}</small></div><span class="guest-visits">${guest.stays.toLocaleString("ar-SA")} ${guest.stays === 1 ? "إقامة" : "إقامات"}<br><small>${formatCurrency(guest.total)}</small></span></article>`).join("") : `<div class="panel empty-state">لا يوجد نزلاء يطابقون البحث.</div>`}</section>`;
}

function renderReports() {
  const currentMonth = formatInputDate(today).slice(0, 7);
  const monthBookings = state.bookings.filter((booking) => booking.checkIn.slice(0, 7) === currentMonth && booking.status !== "cancelled");
  const monthRevenue = monthBookings.reduce((sum, booking) => sum + Number(booking.amount || 0), 0);
  const occupancy = Math.round((roomCatalog.filter((room) => ["occupied", "reserved"].includes(bookingRoomState(room.id))).length / roomCatalog.length) * 100);
  const averageStay = monthBookings.length
    ? (monthBookings.reduce((sum, booking) => sum + Math.max(1, (new Date(`${booking.checkOut}T12:00:00`) - new Date(`${booking.checkIn}T12:00:00`)) / 86400000), 0) / monthBookings.length).toFixed(1)
    : "0";
  pageContent.innerHTML = `
    <div class="page-heading"><div><h1>التقارير</h1><p>مؤشرات تشغيلية ومالية تساعدك على متابعة أداء الفندق.</p></div><button class="button button-secondary" data-action="export-report">تنزيل تقرير CSV <span>↓</span></button></div>
    <section class="report-grid"><article class="report-stat"><span>إيرادات الشهر</span><strong>${formatCurrency(monthRevenue)}</strong><small>بحسب تواريخ الوصول المسجلة</small></article><article class="report-stat"><span>حجوزات الشهر</span><strong>${monthBookings.length.toLocaleString("ar-SA")}</strong><small>حجوزات غير ملغاة</small></article><article class="report-stat"><span>متوسط مدة الإقامة</span><strong>${averageStay} <small>ليلة</small></strong><small>لكل حجز خلال الشهر</small></article><article class="report-stat"><span>نسبة الإشغال الحالية</span><strong>${occupancy.toLocaleString("ar-SA")}٪</strong><small>من إجمالي ${roomCatalog.length.toLocaleString("ar-SA")} غرفة</small></article><article class="report-stat"><span>إجمالي النزلاء</span><strong>${new Set(state.bookings.map((booking) => booking.phone || booking.guestName)).size.toLocaleString("ar-SA")}</strong><small>حسب أرقام التواصل المسجلة</small></article><article class="report-stat"><span>الغرف تحت الصيانة</span><strong>${state.maintenanceRooms.length.toLocaleString("ar-SA")}</strong><small>تُستثنى من الغرف المتاحة</small></article></section>
    <section class="panel section-panel"><div class="panel-header"><div><h2 class="panel-heading">سجل الحجوزات</h2><p class="panel-subtitle">بيانات الحجوزات المسجلة في النظام</p></div></div><div class="table-wrap"><table><thead><tr><th>رقم الحجز</th><th>النزيل</th><th>الغرفة</th><th>الإقامة</th><th>المبلغ</th><th>الحالة</th></tr></thead><tbody>${bookingRows([...state.bookings].sort((a, b) => b.checkIn.localeCompare(a.checkIn)), Infinity, false)}</tbody></table></div></section>`;
}

const pageRenderers = { dashboard: renderDashboard, bookings: renderBookings, rooms: renderRooms, guests: renderGuests, reports: renderReports };
const pageTitles = { dashboard: "لوحة التحكم", bookings: "الحجوزات", rooms: "الغرف", guests: "النزلاء", reports: "التقارير" };

function render() {
  document.querySelector("#breadcrumb-title").textContent = pageTitles[currentPage];
  document.querySelector("#booking-count").textContent = state.bookings.filter((booking) => ["confirmed", "checked-in"].includes(booking.status)).length.toLocaleString("ar-SA");
  document.querySelectorAll(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.page === currentPage));
  pageRenderers[currentPage]();
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

function openBookingModal() {
  const minDate = formatInputDate(today);
  bookingForm.reset();
  document.querySelector("#check-in-input").min = minDate;
  document.querySelector("#check-out-input").min = minDate;
  document.querySelector("#check-in-input").value = minDate;
  const tomorrow = dateOffset(1);
  document.querySelector("#check-out-input").value = tomorrow;
  refreshRoomOptions();
  modalBackdrop.hidden = false;
  document.querySelector('[name="guestName"]').focus();
}

function closeBookingModal() {
  modalBackdrop.hidden = true;
}

function refreshRoomOptions() {
  const roomType = document.querySelector("#room-type").value;
  const checkIn = document.querySelector("#check-in-input").value;
  const checkOut = document.querySelector("#check-out-input").value;
  const roomSelect = document.querySelector("#room-select");
  const possible = roomCatalog.filter((room) => (roomType === "all" || room.type === roomType)
    && !state.maintenanceRooms.includes(room.id)
    && !state.bookings.some((booking) => booking.roomId === room.id && ["confirmed", "checked-in"].includes(booking.status)
      && booking.checkIn < checkOut && booking.checkOut > checkIn));
  roomSelect.innerHTML = possible.map((room) => `<option value="${escapeHtml(room.id)}">غرفة ${escapeHtml(room.id)} · ${escapeHtml(room.type)} · ${room.price.toLocaleString("ar-SA")} ر.س</option>`).join("");
  roomSelect.disabled = possible.length === 0;
  if (!possible.length) roomSelect.innerHTML = `<option value="">لا توجد غرف متاحة لهذه الفترة</option>`;
}

async function addBooking(formData) {
  const checkIn = String(formData.get("checkIn"));
  const checkOut = String(formData.get("checkOut"));
  const roomId = String(formData.get("roomId"));
  if (checkOut <= checkIn) {
    showToast("تاريخ المغادرة يجب أن يكون بعد تاريخ الوصول.");
    return;
  }
  const room = roomCatalog.find((item) => item.id === roomId);
  if (!room || state.maintenanceRooms.includes(roomId)) {
    showToast("الغرفة المحددة غير متاحة للحجز.");
    refreshRoomOptions();
    return;
  }
  const conflict = state.bookings.some((booking) => booking.roomId === roomId && ["confirmed", "checked-in"].includes(booking.status)
    && booking.checkIn < checkOut && booking.checkOut > checkIn);
  if (conflict) {
    showToast("الغرفة محجوزة في هذه الفترة. اختر غرفة أخرى.");
    refreshRoomOptions();
    return;
  }
  const newBooking = {
    id: `NZ-${Date.now().toString().slice(-6)}`,
    guestName: String(formData.get("guestName")).trim(),
    phone: String(formData.get("phone")).trim(),
    email: String(formData.get("email")).trim(),
    roomId,
    roomType: room.type,
    guests: Number(formData.get("guests")),
    checkIn,
    checkOut,
    amount: Number(formData.get("amount")),
    status: "confirmed",
  };
  if (supabaseClient) {
    if (!authSession) {
      showToast("سجل الدخول أولًا لإضافة حجز.");
      return;
    }
    const { data, error } = await supabaseClient.from("bookings")
      .insert(toBookingRecord(newBooking, authSession.user.id))
      .select()
      .single();
    if (error) {
      console.error("تعذر حفظ الحجز في Supabase:", error);
      showToast(error.code === "23P01"
        ? "الغرفة حُجزت في هذه الفترة من جهاز آخر. اختر غرفة مختلفة."
        : `تعذر حفظ الحجز: ${error.message}`);
      refreshRoomOptions();
      return;
    }
    state.bookings.unshift(fromBookingRecord(data));
  } else {
    state.bookings.unshift(newBooking);
    persistState();
  }
  closeBookingModal();
  currentPage = "bookings";
  globalQuery = "";
  bookingStatusFilter = "all";
  render();
  showToast("تم تسجيل الحجز بنجاح.");
}

async function handleBookingAction(action, bookingId) {
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) return;
  if (action === "check-in" && booking.status === "confirmed") {
    if (supabaseClient) {
      const { error } = await supabaseClient.from("bookings").update({ status: "checked-in" })
        .eq("booking_code", bookingId).eq("user_id", authSession.user.id);
      if (error) {
        console.error("تعذر تسجيل دخول النزيل:", error);
        showToast(`تعذر تحديث الحجز: ${error.message}`);
        return;
      }
    }
    booking.status = "checked-in";
    persistState();
    render();
    showToast(`تم تسجيل دخول ${booking.guestName}.`);
  } else if (action === "check-out" && booking.status === "checked-in") {
    if (supabaseClient) {
      const { error } = await supabaseClient.from("bookings").update({ status: "completed" })
        .eq("booking_code", bookingId).eq("user_id", authSession.user.id);
      if (error) {
        console.error("تعذر تسجيل مغادرة النزيل:", error);
        showToast(`تعذر تحديث الحجز: ${error.message}`);
        return;
      }
    }
    booking.status = "completed";
    persistState();
    render();
    showToast(`تم تسجيل مغادرة ${booking.guestName}.`);
  } else if (action === "delete" && ["completed", "cancelled"].includes(booking.status)) {
    if (supabaseClient) {
      const { error } = await supabaseClient.from("bookings").delete()
        .eq("booking_code", bookingId).eq("user_id", authSession.user.id);
      if (error) {
        console.error("تعذر حذف الحجز:", error);
        showToast(`تعذر حذف الحجز: ${error.message}`);
        return;
      }
    }
    state.bookings = state.bookings.filter((item) => item.id !== bookingId);
    persistState();
    render();
    showToast("تم حذف سجل الحجز.");
  }
}

async function toggleRoomMaintenance(roomId) {
  const isUnderMaintenance = state.maintenanceRooms.includes(roomId);
  if (supabaseClient) {
    const result = isUnderMaintenance
      ? await supabaseClient.from("room_maintenance").delete().eq("room_id", roomId).eq("user_id", authSession.user.id)
      : await supabaseClient.from("room_maintenance").insert({ room_id: roomId, user_id: authSession.user.id });
    if (result.error) {
      console.error("تعذر تحديث صيانة الغرفة:", result.error);
      showToast(`تعذر تحديث الغرفة: ${result.error.message}`);
      return;
    }
  }
  state.maintenanceRooms = isUnderMaintenance
    ? state.maintenanceRooms.filter((id) => id !== roomId)
    : [...state.maintenanceRooms, roomId];
  persistState();
  render();
  showToast(isUnderMaintenance ? `الغرفة ${roomId} متاحة الآن.` : `تم تحديث حالة الغرفة ${roomId} إلى الصيانة.`);
}

function exportReport() {
  const header = ["رقم الحجز", "اسم النزيل", "الجوال", "رقم الغرفة", "نوع الغرفة", "تاريخ الوصول", "تاريخ المغادرة", "المبلغ (ر.س)", "الحالة"];
  const rows = state.bookings.map((booking) => [booking.id, booking.guestName, booking.phone, booking.roomId, booking.roomType, booking.checkIn, booking.checkOut, booking.amount, statusLabels[booking.status] || booking.status]);
  const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `neon-stay-pro-report-${formatInputDate(today)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("تم تجهيز تقرير الحجوزات للتنزيل.");
}

function navigate(page) {
  if (!pageRenderers[page]) return;
  currentPage = page;
  globalQuery = "";
  document.querySelector("#global-search").value = "";
  document.querySelector("#sidebar").classList.remove("open");
  render();
}

document.addEventListener("click", (event) => {
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) {
    event.preventDefault();
    navigate(pageButton.dataset.page);
    return;
  }
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const { action, id } = actionButton.dataset;
  if (action === "new-booking") openBookingModal();
  if (["check-in", "check-out", "delete"].includes(action)) {
    void handleBookingAction(action, id).catch((error) => {
      console.error("تعذر تنفيذ إجراء الحجز:", error);
      showToast(`تعذر تنفيذ الإجراء: ${error.message || "حدث خطأ غير متوقع."}`);
    });
  }
  if (action === "toggle-maintenance") {
    void toggleRoomMaintenance(id).catch((error) => {
      console.error("تعذر تحديث صيانة الغرفة:", error);
      showToast(`تعذر تحديث الغرفة: ${error.message || "حدث خطأ غير متوقع."}`);
    });
  }
  if (action === "export-report") exportReport();
});

document.querySelector("#mobile-menu").addEventListener("click", () => {
  document.querySelector("#sidebar").classList.toggle("open");
});
document.querySelector("#close-modal").addEventListener("click", closeBookingModal);
document.querySelector("#cancel-modal").addEventListener("click", closeBookingModal);
modalBackdrop.addEventListener("click", (event) => {
  if (event.target === modalBackdrop) closeBookingModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeBookingModal();
    document.querySelector("#sidebar").classList.remove("open");
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    document.querySelector("#global-search").focus();
  }
});
bookingForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!bookingForm.reportValidity()) return;
  void addBooking(new FormData(bookingForm)).catch((error) => {
    console.error("تعذر إضافة الحجز:", error);
    showToast(`تعذر إضافة الحجز: ${error.message || "حدث خطأ غير متوقع."}`);
  });
});
document.querySelector("#auth-toggle").addEventListener("click", () => {
  setAuthMode(authMode === "signin" ? "signup" : "signin");
});
document.querySelector("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity() || !supabaseClient) return;
  const form = new FormData(event.currentTarget);
  const email = String(form.get("email")).trim();
  const password = String(form.get("password"));
  const submitButton = document.querySelector("#auth-submit");
  submitButton.disabled = true;
  clearAuthError();
  try {
    const result = authMode === "signup"
      ? await supabaseClient.auth.signUp({ email, password })
      : await supabaseClient.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    if (authMode === "signup" && !result.data.session) {
      setAuthMode("signin");
      showAuthMessage("تم إنشاء الحساب. تحقق من بريدك الإلكتروني لتأكيده، ثم سجل الدخول.");
    }
  } catch (error) {
    console.error("تعذرت المصادقة مع Supabase:", error);
    showAuthError(`تعذر ${authMode === "signup" ? "إنشاء الحساب" : "تسجيل الدخول"}: ${error.message || "تحقق من البيانات وحاول مجددًا."}`);
  } finally {
    submitButton.disabled = false;
  }
});
document.querySelector("#room-type").addEventListener("change", refreshRoomOptions);
document.querySelector("#check-in-input").addEventListener("change", () => {
  const checkIn = document.querySelector("#check-in-input");
  const checkOut = document.querySelector("#check-out-input");
  checkOut.min = checkIn.value || formatInputDate(today);
  if (checkOut.value <= checkIn.value) {
    const arrival = new Date(`${checkIn.value}T12:00:00`);
    arrival.setDate(arrival.getDate() + 1);
    checkOut.value = formatInputDate(arrival);
  }
  refreshRoomOptions();
});
document.querySelector("#check-out-input").addEventListener("change", refreshRoomOptions);
document.querySelector("#global-search").addEventListener("input", (event) => {
  globalQuery = event.target.value;
  if (currentPage === "dashboard" && globalQuery.trim()) currentPage = "bookings";
  render();
  const localSearch = document.querySelector("#booking-search, #room-search, #guest-search");
  if (localSearch) {
    localSearch.focus();
    localSearch.setSelectionRange(localSearch.value.length, localSearch.value.length);
  }
});
pageContent.addEventListener("input", (event) => {
  if (event.target.id === "booking-search" || event.target.id === "room-search" || event.target.id === "guest-search") {
    globalQuery = event.target.value;
    const selectionStart = event.target.selectionStart;
    render();
    const updatedSearch = document.querySelector(`#${event.target.id}`);
    if (updatedSearch) {
      updatedSearch.focus();
      updatedSearch.setSelectionRange(selectionStart, selectionStart);
    }
  }
});
pageContent.addEventListener("change", (event) => {
  if (event.target.id === "booking-status-filter") {
    bookingStatusFilter = event.target.value;
    render();
  }
});
document.querySelector("#notification-button").addEventListener("click", () => showToast("لا توجد إشعارات جديدة."));
document.querySelector("#help-button").addEventListener("click", () => showToast("ابدأ بإضافة حجز، ثم تابع حالة الغرف من القائمة."));
document.querySelector("#profile-button").addEventListener("click", async () => {
  if (!supabaseClient || !authSession) {
    showToast("البيانات محفوظة محليًا على هذا الجهاز.");
    return;
  }
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
  } catch (error) {
    console.error("تعذر تسجيل الخروج:", error);
    showToast(`تعذر تسجيل الخروج: ${error.message || "حدث خطأ غير متوقع."}`);
  }
});
document.querySelector("#today-label").textContent = new Intl.DateTimeFormat("ar-SA", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(today);

void initializeApp();
