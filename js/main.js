document.addEventListener('DOMContentLoaded', () => {
    console.log('GalaLMur — страница загружена');

    const bookingModal = document.getElementById('bookingModal');
    const modalDressName = document.getElementById('modalDressName');
    const closeBookingBtn = document.getElementById('closeBookingModal');
    const dateStartInput = document.getElementById('dateStart');
    const dateEndInput = document.getElementById('dateEnd');
    const confirmBtn = document.getElementById('confirmBooking');
    const priceCalcBlock = document.getElementById('priceCalc');
    const calcDaysEl = document.getElementById('calcDays');
    const calcTotalEl = document.getElementById('calcTotal');
    const cartCountEl = document.getElementById('cartCount');

    const toastOverlay = document.getElementById('toastOverlay');
    const toastBackdrop = document.getElementById('toastBackdrop');
    const toast = document.getElementById('toast');
    const toastIcon = document.getElementById('toastIcon');
    const toastMessage = document.getElementById('toastMessage');
    const toastClose = document.getElementById('toastClose');

    let currentPricePerDay = 0;
    let toastTimer = null;
    let currentPaymentBookingId = null;
    let currentFilter = 'all';
    let selectedSizes = [];

    async function updateCartCount() {
        try { const res = await fetch('/api/bookings'); const data = await res.json(); if (cartCountEl && data.bookings) cartCountEl.textContent = data.bookings.length; } catch(e) {}
    }
    updateCartCount();

    async function checkAuth() {
        try {
            const res = await fetch('/api/me'); const data = await res.json();
            if (data.loggedIn) {
                document.getElementById('userGreeting').textContent = data.user.name;
                document.getElementById('authBtn').style.display = 'none';
                document.getElementById('userMenu').style.display = 'inline-block';
                if (data.user.role === 'admin') {
                    document.getElementById('adminLink').style.display = 'block';
                }
                updateCartCount();
            }
        } catch(e) {}
    }
    checkAuth();

    function showToast(message, isError = false) {
        if (toastTimer) clearTimeout(toastTimer);
        toast.classList.remove('toast--success', 'toast--error');
        if (isError) { toast.classList.add('toast--error'); toastIcon.textContent = '✗'; }
        else { toast.classList.add('toast--success'); toastIcon.textContent = '✓'; }
        toastMessage.textContent = message;
        toastOverlay.classList.add('toast-overlay--show'); toastBackdrop.classList.add('toast-backdrop--show');
        toastTimer = setTimeout(hideToast, 5000);
    }
    function hideToast() { toastOverlay.classList.remove('toast-overlay--show'); toastBackdrop.classList.remove('toast-backdrop--show'); if (toastTimer) clearTimeout(toastTimer); }
    toastClose.addEventListener('click', hideToast);
    toastBackdrop.addEventListener('click', hideToast);

    function openBookingModal(dressName, price) {
        currentPricePerDay = price;
        modalDressName.textContent = 'Платье: ' + dressName;
        bookingModal.style.display = 'flex';
        const today = new Date().toISOString().split('T')[0];
        dateStartInput.setAttribute('min', today); dateEndInput.setAttribute('min', today);
        dateStartInput.value = ''; dateEndInput.value = '';
        priceCalcBlock.style.display = 'none';
        document.getElementById('bookingSize').value = 'S';
    }
    function closeBookingModal() { bookingModal.style.display = 'none'; }
    closeBookingBtn.addEventListener('click', closeBookingModal);
    bookingModal.addEventListener('click', (e) => { if (e.target === bookingModal) closeBookingModal(); });

    dateStartInput.addEventListener('change', () => { dateEndInput.setAttribute('min', dateStartInput.value); dateEndInput.value = ''; priceCalcBlock.style.display = 'none'; });
    dateEndInput.addEventListener('change', () => {
        const startVal = dateStartInput.value, endVal = dateEndInput.value;
        if (!startVal || !endVal) { priceCalcBlock.style.display = 'none'; return; }
        const startDate = new Date(startVal), endDate = new Date(endVal);
        if (endDate < startDate) { priceCalcBlock.style.display = 'none'; return; }
        const diffDays = Math.ceil((endDate - startDate) / (1000*60*60*24)) + 1;
        if (diffDays > 0 && diffDays < 365) {
            calcDaysEl.textContent = diffDays;
            calcTotalEl.textContent = (diffDays * currentPricePerDay).toLocaleString('ru-RU') + ' ₽';
            priceCalcBlock.style.display = 'block';
        }
    });

    async function confirmBooking() {
        const dress = modalDressName.textContent.replace('Платье: ', '');
        const size = document.getElementById('bookingSize').value;
        const dateStart = dateStartInput.value, dateEnd = dateEndInput.value;
        const days = parseInt(calcDaysEl.textContent), total = calcTotalEl.textContent;
        if (!dateStart || !dateEnd) { showToast('Выберите даты аренды', true); return; }
        const today = new Date(); today.setHours(0,0,0,0);
        if (new Date(dateStart) < today) { showToast('Дата начала не может быть в прошлом', true); return; }
        if (new Date(dateEnd) < today) { showToast('Дата окончания не может быть в прошлом', true); return; }
        if (new Date(dateEnd) < new Date(dateStart)) { showToast('Дата окончания не может быть раньше даты начала', true); return; }
        try {
            const res = await fetch('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dress, size, date_start: dateStart, date_end: dateEnd, days, total }) });
            const data = await res.json();
            if (data.success) { closeBookingModal(); showPaymentModal(data.bookingId, dress, size, dateStart, dateEnd, days, total, data.commission); }
            else { showToast(data.message, true); if (data.message.includes('войти') || data.message.includes('зарегистрироваться')) openAuthModal(); }
        } catch(e) { showToast('Ошибка соединения с сервером', true); }
    }
    confirmBtn.addEventListener('click', confirmBooking);

    async function showPaymentModal(bookingId, dress, size, dateStart, dateEnd, days, total, commission) {
        currentPaymentBookingId = bookingId;
        document.getElementById('paymentDress').textContent = dress;
        document.getElementById('paymentDetails').textContent = 'Размер: ' + size + ' | ' + dateStart + ' - ' + dateEnd + ' | ' + days + ' дн.';
        document.getElementById('paymentTotal').textContent = total;
        document.getElementById('paymentCommission').textContent = commission;
        document.getElementById('paymentModal').style.display = 'flex';
        try {
            const res = await fetch('/api/bookings/' + bookingId + '/qr'); const data = await res.json();
            if (data.success) { document.getElementById('qrImage').src = data.qr; document.getElementById('qrPlaceholder').style.display = 'none'; document.getElementById('qrImage').style.display = 'block'; }
        } catch(e) {}
    }
    function closePaymentModal() { document.getElementById('paymentModal').style.display = 'none'; updateCartCount(); }
    async function confirmPayment() {
        const btn = document.getElementById('payBtn'); btn.textContent = 'Оплата...'; btn.disabled = true;
        try {
            const res = await fetch('/api/bookings/' + currentPaymentBookingId + '/pay', { method: 'POST' }); const data = await res.json();
            if (data.success) { showToast('Оплата подтверждена!', false); closePaymentModal(); }
            else { showToast(data.message, true); }
        } catch(e) { showToast('Ошибка соединения', true); }
        btn.textContent = 'Подтвердить оплату'; btn.disabled = false;
    }
    document.getElementById('paymentModal').addEventListener('click', function(e) { if (e.target === this) closePaymentModal(); });

    function openAuthModal() { document.getElementById('authModal').style.display = 'flex'; }
    function closeAuthModal() { document.getElementById('authModal').style.display = 'none'; }
    document.getElementById('authModal').addEventListener('click', function(e) { if (e.target === this) closeAuthModal(); });

    document.getElementById('cartLink').addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            const res = await fetch('/api/bookings'); const data = await res.json(); const bookings = data.bookings || [];
            document.getElementById('cartModal').style.display = 'flex';
            if (bookings.length === 0) { document.getElementById('cartEmpty').style.display = 'block'; document.getElementById('cartContent').style.display = 'none'; }
            else {
                document.getElementById('cartEmpty').style.display = 'none'; document.getElementById('cartContent').style.display = 'block';
                document.getElementById('cartBody').innerHTML = bookings.map(b => `<tr><td>${b.dress}</td><td>${b.size}</td><td>${b.date_start}</td><td>${b.date_end}</td><td>${b.days}</td><td>${b.total}</td><td><button class="btn-delete" onclick="deleteBooking(${b.id})">✕</button></td></tr>`).join('');
            }
        } catch(e) { showToast('Войдите чтобы посмотреть бронирования', true); }
    });

    function openAboutModal() { document.getElementById('aboutModal').style.display = 'flex'; }
    function closeAboutModal() { document.getElementById('aboutModal').style.display = 'none'; }

    function openAddDressModal() { document.getElementById('addDressModal').style.display = 'flex'; }
    function closeAddDressModal() { document.getElementById('addDressModal').style.display = 'none'; }
    document.getElementById('addDressModal').addEventListener('click', function(e) { if (e.target === this) closeAddDressModal(); });

    async function addDress() {
        const title = document.getElementById('dressTitle').value.trim();
        const description = document.getElementById('dressDesc').value.trim();
        const price = document.getElementById('dressPrice').value.trim();
        const category = document.getElementById('dressCategory').value;
        const imageFile = document.getElementById('dressImage').files[0];
        const sizes = [];
        document.querySelectorAll('.dress-size:checked').forEach(cb => sizes.push(cb.value));
        if (!title) { showToast('Введите название', true); return; }
        if (!description) { showToast('Введите описание', true); return; }
        if (!price || parseInt(price) <= 0) { showToast('Цена должна быть больше 0 ₽', true); return; }
        if (sizes.length === 0) { showToast('Выберите размеры', true); return; }
        if (!imageFile) { showToast('Загрузите фото', true); return; }
        const formData = new FormData();
        formData.append('title', title); formData.append('description', description);
        formData.append('price_per_day', price); formData.append('category', category);
        formData.append('sizes', sizes.join(', ')); formData.append('image', imageFile);
        try {
            const res = await fetch('/api/dresses', { method: 'POST', body: formData }); const data = await res.json();
            if (data.success) { showToast('Наряд добавлен!', false); closeAddDressModal(); document.getElementById('dressTitle').value = ''; document.getElementById('dressDesc').value = ''; document.getElementById('dressPrice').value = ''; document.getElementById('dressImage').value = ''; document.querySelectorAll('.dress-size').forEach(cb => cb.checked = false); loadCatalogDresses(); }
            else { showToast(data.message, true); }
        } catch(e) { showToast('Ошибка соединения', true); }
    }

    async function loadCatalogDresses() {
        try {
            const res = await fetch('/api/dresses');
            const serverDresses = await res.json();
            window.catalogDresses = serverDresses.map(d => ({
                name: d.title,
                price: d.price_per_day,
                desc: d.description,
                img: d.image_url || null,
                sizes: d.sizes,
                category: d.category
            }));
            renderAllDresses();
        } catch(e) {}
    }

    function renderAllDresses() {
        const grid = document.getElementById('dressesGrid');
        
        if (!window.catalogDresses || window.catalogDresses.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px;color:#999;font-size:16px;">Нет доступных нарядов. <a href="#" onclick="openAuthModal()" style="color:#8B6B4A;">Войдите</a> и добавьте первый наряд!</div>';
            return;
        }

        let dressesToShow = window.catalogDresses;
        
        if (currentFilter === 'wedding') {
            dressesToShow = dressesToShow.filter(d => d.category === 'wedding');
        } else if (currentFilter === 'evening') {
            dressesToShow = dressesToShow.filter(d => d.category === 'evening');
        } else if (currentFilter === 'suit') {
            dressesToShow = dressesToShow.filter(d => d.category === 'suit');
        }

        if (selectedSizes.length > 0) {
    dressesToShow = dressesToShow.filter(d => {
        const sizes = d.sizes.split(',').map(s => s.trim());
        return selectedSizes.some(s => sizes.includes(s));
    });
}

        if (dressesToShow.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px;color:#999;font-size:16px;">Нет нарядов в этой категории</div>';
            return;
        }

        grid.innerHTML = dressesToShow.map(d => `
            <article class="card">
                <div class="card__img-wrapper"><img src="${d.img || ''}" alt="${d.name}" class="card__img" onerror="this.parentElement.innerHTML='<div style=display:flex;align-items:center;justify-content:center;height:100%;font-size:18px;color:#999;>Нет фото</div>';"></div>
                <div class="card__body">
                    <h2 class="card__title">${d.name}</h2>
                    <p class="card__price">${d.price.toLocaleString('ru-RU')} ₽ / день</p>
                    <p class="card__desc">${d.desc}</p>
                    <p class="card__sizes">Размеры: ${d.sizes}</p>
                    <button class="card__btn" data-dress="${d.name}" data-price="${d.price}">Взять в прокат</button>
                </div>
            </article>
        `).join('');

        document.querySelectorAll('.card__btn').forEach(btn => {
            btn.addEventListener('click', () => {
                openBookingModal(btn.getAttribute('data-dress'), parseInt(btn.getAttribute('data-price'), 10));
            });
        });
    }

    window.applySizeFilter = function() {
    selectedSizes = [];
    document.querySelectorAll('.size-filter:checked').forEach(cb => selectedSizes.push(cb.value));
    renderAllDresses();
};
    
    window.filterCategory = function(category) {
        currentFilter = category;
        renderAllDresses();
    };

    function openContactsModal() { document.getElementById('contactsModal').style.display = 'flex'; }
    function closeContactsModal() { document.getElementById('contactsModal').style.display = 'none'; }
    document.getElementById('contactsModal').addEventListener('click', function(e) { if (e.target === this) closeContactsModal(); });

    function openPrivacyModal() { document.getElementById('privacyModal').style.display = 'flex'; }
    function closePrivacyModal() { document.getElementById('privacyModal').style.display = 'none'; }
    document.getElementById('privacyModal').addEventListener('click', function(e) { if (e.target === this) closePrivacyModal(); });

    function openContractsModal() { document.getElementById('contractsModal').style.display = 'flex'; }
    function closeContractsModal() { document.getElementById('contractsModal').style.display = 'none'; }
    document.getElementById('contractsModal').addEventListener('click', function(e) { if (e.target === this) closeContractsModal(); });

    function openLicensesModal() { document.getElementById('licensesModal').style.display = 'flex'; }
    function closeLicensesModal() { document.getElementById('licensesModal').style.display = 'none'; }
    document.getElementById('licensesModal').addEventListener('click', function(e) { if (e.target === this) closeLicensesModal(); });

    function openBecomePartnerModal() { document.getElementById('becomePartnerModal').style.display = 'flex'; }
    function closeBecomePartnerModal() { document.getElementById('becomePartnerModal').style.display = 'none'; }
    document.getElementById('becomePartnerModal').addEventListener('click', function(e) { if (e.target === this) closeBecomePartnerModal(); });

    function sendPartnerRequest() {
        const name = document.getElementById('partnerName').value;
        const email = document.getElementById('partnerEmail').value;
        if (!name || !email) { showToast('Заполните имя и email', true); return; }
        showToast('Заявка отправлена!', false);
        closeBecomePartnerModal();
        document.getElementById('partnerName').value = '';
        document.getElementById('partnerEmail').value = '';
        document.getElementById('partnerPhone').value = '';
        document.getElementById('partnerMessage').value = '';
    }

    const phoneBtn = document.querySelector('.seller-phone');
    if (phoneBtn) { phoneBtn.addEventListener('click', () => { phoneBtn.textContent = '+7 (999) 123-45-67'; phoneBtn.style.background = '#5C3D2E'; phoneBtn.style.borderColor = '#E8D5C4'; }); }

    window.openAuthModal = openAuthModal;
    window.closeAuthModal = closeAuthModal;
    window.switchTab = function(tab) {
        document.getElementById('form-login').style.display = tab === 'login' ? 'block' : 'none';
        document.getElementById('form-register').style.display = tab === 'register' ? 'block' : 'none';
        document.getElementById('tabLoginBtn').style.background = tab === 'login' ? '#8B6B4A' : '#A08060';
        document.getElementById('tabRegisterBtn').style.background = tab === 'register' ? '#8B6B4A' : '#A08060';
    };
    window.register = async function() {
        const res = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ full_name: document.getElementById('regName').value, email: document.getElementById('regEmail').value, phone: document.getElementById('regPhone').value, password: document.getElementById('regPassword').value }) });
        const data = await res.json(); showToast(data.message, !data.success); if (data.success) { closeAuthModal(); checkAuth(); }
    };
    window.login = async function() {
        const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: document.getElementById('loginEmail').value, password: document.getElementById('loginPassword').value }) });
        const data = await res.json(); showToast(data.message, !data.success); if (data.success) { closeAuthModal(); checkAuth(); }
    };
    window.logout = async function() {
        await fetch('/api/logout', { method: 'POST' });
        document.getElementById('userGreeting').textContent = '';
        document.getElementById('authBtn').style.display = 'inline';
        document.getElementById('userMenu').style.display = 'none';
        document.getElementById('adminLink').style.display = 'none';
        document.getElementById('cartCount').textContent = '0';
        showToast('Вы вышли из аккаунта', false);
    };
    window.closeCartModal = function() { document.getElementById('cartModal').style.display = 'none'; };
    document.getElementById('cartModal').addEventListener('click', function(e) { if (e.target === this) window.closeCartModal(); });
    window.deleteBooking = async function(id) { await fetch('/api/bookings/' + id, { method: 'DELETE' }); showToast('Бронирование удалено', false); window.closeCartModal(); updateCartCount(); };
    window.showPaymentModal = showPaymentModal;
    window.closePaymentModal = closePaymentModal;
    window.confirmPayment = confirmPayment;
    window.openAboutModal = openAboutModal;
    window.closeAboutModal = closeAboutModal;
    window.openAddDressModal = openAddDressModal;
    window.closeAddDressModal = closeAddDressModal;
    window.addDress = addDress;
    window.openContactsModal = openContactsModal;
    window.closeContactsModal = closeContactsModal;
    window.openPrivacyModal = openPrivacyModal;
    window.closePrivacyModal = closePrivacyModal;
    window.openContractsModal = openContractsModal;
    window.closeContractsModal = closeContractsModal;
    window.openLicensesModal = openLicensesModal;
    window.closeLicensesModal = closeLicensesModal;
    window.openBecomePartnerModal = openBecomePartnerModal;
    window.closeBecomePartnerModal = closeBecomePartnerModal;
    window.sendPartnerRequest = sendPartnerRequest;
    window.filterCategory = filterCategory;

    loadCatalogDresses();
});