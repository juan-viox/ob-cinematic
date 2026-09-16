(function() {
  /* The animation library loads from a CDN. If it is unavailable, stub it out
     so forms, the modal and the carousel still work and no content stays
     hidden behind a fade-in that will never fire. */
  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') {
    document.documentElement.classList.remove('anim');
    var noop = function() { return { kill: noop }; };
    window.gsap = window.gsap || {
      registerPlugin: noop, to: noop, from: noop, fromTo: noop, set: noop,
      utils: { toArray: function() { return []; } }
    };
    window.ScrollTrigger = window.ScrollTrigger || { create: noop, refresh: noop };
  } else {
    clearTimeout(window.__animFailsafe);
  }

  gsap.registerPlugin(ScrollTrigger);

  /* ─── Navigation Scroll ─── */
  var nav = document.getElementById('mainNav');
  ScrollTrigger.create({
    trigger: '#hero',
    start: 'top top',
    end: 'bottom 80px',
    onLeave: function() { nav.classList.add('scrolled'); },
    onEnterBack: function() { nav.classList.remove('scrolled'); }
  });

  /* ─── Mobile Menu ─── */
  window.toggleMobile = function() {
    var m = document.getElementById('mobileMenu');
    if (m) m.classList.toggle('active');
  };

  /* ─── Hero photo: scroll-driven slow zoom ───
     Replaced the 121-frame canvas playback. The frames remain in
     assets/frames/ if that treatment is ever wanted back. */
  var heroSection = document.getElementById('hero');
  var heroPhoto = document.getElementById('heroPhoto');
  var heroFallback = document.getElementById('heroFallback');

  if (heroPhoto) {
    heroPhoto.addEventListener('load', function() {
      if (heroFallback) heroFallback.style.display = 'none';
    });
    if (heroPhoto.complete && heroFallback) heroFallback.style.display = 'none';

    var reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!reduceMotion && heroSection && window.gsap) {
      gsap.fromTo(heroPhoto, { scale: 1 }, {
        scale: 1.1,
        ease: 'none',
        scrollTrigger: {
          trigger: heroSection,
          start: 'top top',
          end: 'bottom bottom',
          scrub: 0.4
        }
      });
    }
  }

  /* ─── Text Mask Reveal ─── */
  var maskSection = document.querySelector('.mask-section');
  if (maskSection) {
    gsap.to('.mask-reveal', {
      clipPath: 'inset(0% 0 0 0)',
      ease: 'none',
      scrollTrigger: {
        trigger: maskSection,
        start: 'top top',
        end: '60% bottom',
        scrub: 0.3
      }
    });
    gsap.to('.mask-subtext', {
      opacity: 1, y: 0,
      scrollTrigger: {
        trigger: maskSection,
        start: '55% top',
        end: '70% top',
        scrub: true
      }
    });
  }

  /* ─── Kinetic Marquee ─── */
  document.querySelectorAll('.marquee-row').forEach(function(row) {
    var content = row.querySelector('.marquee-content');
    if (content) {
      row.appendChild(content.cloneNode(true));
    }
  });

  var marqueeRows = document.querySelectorAll('.marquee-row');
  var baseSpeed = 60;
  var scrollVelocity = 0;

  ScrollTrigger.create({
    onUpdate: function(self) {
      scrollVelocity = Math.abs(self.getVelocity());
    }
  });

  marqueeRows.forEach(function(row) {
    var content = row.querySelector('.marquee-content');
    if (!content) return;
    var direction = row.dataset.direction === 'right' ? 1 : -1;
    var speedMult = parseFloat(row.dataset.speed) || 1;
    var contentWidth = content.offsetWidth;
    var x = direction === -1 ? 0 : -contentWidth;

    function animate() {
      var speed = (baseSpeed + scrollVelocity * 0.12) * speedMult;
      x += direction * -1 * speed / 60;
      if (direction === -1 && x <= -contentWidth) x += contentWidth;
      if (direction === 1 && x >= 0) x -= contentWidth;
      row.style.transform = 'translateX(' + x + 'px)';
      requestAnimationFrame(animate);
    }
    animate();
  });

  /* ─── 3D Coverflow Carousel ─── */
  var products = [
    {name:'Love You', price:'$150', img: '/assets/img/OB0_7441-500w.jpg'},
    {name:'Just Peachy', price:'$132', img: '/assets/img/OB0_7537-500w.jpg'},
    {name:'Long Weekend', price:'$120', img: '/assets/img/OB0_7721-500w.jpg'},
    {name:'Coffee Lover', price:'$145', img: '/assets/img/OB0_7584-500w.jpg'},
    {name:'Zen', price:'$145', img: '/assets/img/OB0_7512-500w.jpg'},
    {name:'The Hostess', price:'$175', img: '/assets/img/0B0_5612-500w.jpg'},
    {name:"Host's Delight", price:'$105', img: '/assets/img/0B0_5453-500w.jpg'},
    {name:'Nightcap', price:'$120', img: '/assets/img/0B0_5067-500w.jpg'}
  ];

  var track = document.getElementById('productTrack');
  var carouselCurrent = Math.floor(products.length / 2);

  products.forEach(function(item, i) {
    var el = document.createElement('div');
    el.className = 'carousel-item';
    el.style.backgroundImage = 'url(' + item.img + ')';
    el.innerHTML = '<div class="carousel-item-info"><h3>' + item.name + '</h3><p>' + item.price + '</p></div>';
    el.addEventListener('click', function() { carouselCurrent = i; renderCarousel(); });
    if (track) track.appendChild(el);
  });

  window.moveCarousel = function(dir) {
    carouselCurrent = Math.max(0, Math.min(products.length - 1, carouselCurrent + dir));
    renderCarousel();
  };

  function renderCarousel() {
    if (!track) return;
    var els = track.children;
    for (var i = 0; i < els.length; i++) {
      var off = i - carouselCurrent;
      var absOff = Math.abs(off);
      var tx = off * 320;
      var ry = off < 0 ? 35 : off > 0 ? -35 : 0;
      var sc = absOff === 0 ? 1 : 0.82;
      var z = absOff === 0 ? 10 : 10 - absOff;
      var op = absOff > 2 ? 0 : 1 - absOff * 0.25;
      els[i].style.transform = 'translateX(' + tx + 'px) rotateY(' + ry + 'deg) scale(' + sc + ')';
      els[i].style.zIndex = z;
      els[i].style.opacity = op;
      els[i].style.filter = absOff === 0 ? 'brightness(1)' : 'brightness(0.7)';
    }
  }
  renderCarousel();

  /* ─── Sticky Stack (How It Works) ─── */
  var featureCards = document.querySelectorAll('.feature-card');
  var mockupStates = document.querySelectorAll('.mockup-state');

  featureCards.forEach(function(card) {
    ScrollTrigger.create({
      trigger: card,
      start: 'top 60%',
      end: 'bottom 40%',
      onEnter: function() { activateFeature(card.dataset.feature); },
      onEnterBack: function() { activateFeature(card.dataset.feature); }
    });
  });

  function activateFeature(num) {
    featureCards.forEach(function(c) { c.classList.toggle('active', c.dataset.feature === num); });
    mockupStates.forEach(function(s) { s.classList.toggle('active', s.dataset.state === num); });
  }

  /* ─── Sticky Cards (Testimonials) ─── */
  var stackCards = document.querySelectorAll('.stack-card');
  stackCards.forEach(function(card, i) {
    if (i < stackCards.length - 1) {
      gsap.to(card, {
        scale: 0.95, opacity: 0.5,
        scrollTrigger: {
          trigger: stackCards[i + 1],
          start: 'top 80%',
          end: 'top 20%',
          scrub: true
        }
      });
    }
  });

  /* ─── Fade Up Animations ─── */
  gsap.utils.toArray('.fade-up').forEach(function(el) {
    gsap.to(el, {
      opacity: 1, y: 0, duration: 0.8, ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 85%' }
    });
  });

  /* ─── ScrollTrigger refresh after load ─── */
  window.addEventListener('load', function() {
    ScrollTrigger.refresh();
  });

  /* ═══════════════════════════════════════════
     CRM & PAYMENT CONFIGURATION
     Same-origin through the /admin rewrite (OccasionsBox CRM ingest API)
     ═══════════════════════════════════════════ */
  var CRM_CONFIG = { apiUrl: '/admin/api/v1/ingest', enabled: true };

  /* ─── Toast Notifications ─── */
  function showToast(msg, type) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast ' + (type || 'success');
    setTimeout(function() { t.classList.add('show'); }, 10);
    setTimeout(function() { t.classList.remove('show'); }, 3500);
  }

  /* ─── Product Modal + PayPal ─── */
  var allProducts = [
    {name:'Love You', price:150, img: '/assets/img/OB0_7441-750w.jpg'},
    {name:'Just Peachy', price:132, img: '/assets/img/OB0_7537-750w.jpg'},
    {name:'Long Weekend', price:120, img: '/assets/img/OB0_7721-750w.jpg'},
    {name:'Coffee Lover', price:145, img: '/assets/img/OB0_7584-750w.jpg'},
    {name:'Zen', price:145, img: '/assets/img/OB0_7512-750w.jpg'},
    {name:'The Hostess', price:175, img: '/assets/img/0B0_5612-750w.jpg'},
    {name:"Host's Delight - Rose", price:105, img: '/assets/img/0B0_5453-750w.jpg'},
    {name:'Nightcap Essentials', price:120, img: '/assets/img/0B0_5067-750w.jpg'},
    {name:'Lemonade', price:120, img: '/assets/img/0B0_5827-750w.jpg'},
    {name:'Sunshine', price:105, img: '/assets/img/0B0_5699-750w.jpg'},
    {name:'Cheers', price:145, img: '/assets/img/0B0_4910-750w.jpg'},
    {name:'Renewed Deluxe', price:150, img: '/assets/img/0B0_5137-750w.jpg'},
    {name:'Welcome Home', price:125, img: '/assets/img/0B0_5183-750w.jpg'},
    {name:'Home Sweet Home', price:170, img: '/assets/img/0B0_4712-750w.jpg'},
    {name:'Manly', price:150, img: '/assets/img/_MG_1812-750w.jpg'},
    {name:'Goodnight', price:130, img: '/assets/img/ob_1471-750w.jpg'},
    {name:"Host's Delight - Green", price:105, img: '/assets/img/OB_0299-750w.jpg'},
    {name:'Celebrate', price:120, img: '/assets/img/0B0_2489-750w.jpg'},
    {name:'NightTime Ritual', price:150, img: '/assets/img/_MG_1792-750w.jpg'},
    {name:'Mini Spa Day', price:115, img: '/assets/img/IMG_9325-750w.jpg'},
    {name:'Housewarming', price:110, img: '/assets/img/ob_6944-750w.jpg'},
    {name:'Afternoon Tea', price:128, img: '/assets/img/IMG_9730-750w.jpg'}
  ];

  var currentProduct = null;

  function openModal(productName) {
    var product = allProducts.find(function(p) { return p.name === productName; });
    if (!product) return;
    currentProduct = product;

    document.getElementById('modalImg').src = product.img;
    document.getElementById('modalImg').alt = product.name;
    document.getElementById('modalName').textContent = product.name;
    document.getElementById('modalPrice').textContent = '$' + product.price.toFixed(2);
    document.getElementById('modalQty').value = 1;

    document.getElementById('productModal').classList.add('active');
    document.body.style.overflow = 'hidden';

    // Render PayPal buttons
    var container = document.getElementById('paypal-button-container');
    container.innerHTML = '';

    if (typeof paypalSDK !== 'undefined') {
      paypalSDK.Buttons({
        style: {
          layout: 'vertical',
          color: 'gold',
          shape: 'pill',
          label: 'pay',
          height: 45
        },
        createOrder: function(data, actions) {
          var qty = parseInt(document.getElementById('modalQty').value) || 1;
          return actions.order.create({
            purchase_units: [{
              description: currentProduct.name + ' Gift Box',
              amount: {
                value: (currentProduct.price * qty).toFixed(2),
                currency_code: 'USD',
                breakdown: {
                  item_total: { value: (currentProduct.price * qty).toFixed(2), currency_code: 'USD' }
                }
              },
              items: [{
                name: currentProduct.name,
                unit_amount: { value: currentProduct.price.toFixed(2), currency_code: 'USD' },
                quantity: String(qty),
                category: 'PHYSICAL_GOODS'
              }]
            }]
          });
        },
        onApprove: function(data, actions) {
          return actions.order.capture().then(function(details) {
            closeModal();
            // Guest checkout / some funding sources return a payer without a name object.
            var payer = (details && details.payer) || {};
            var given = (payer.name && payer.name.given_name) || '';
            showToast('Order confirmed! Thank you' + (given ? ', ' + given : '') + '.', 'success');

            // Record the order in the OccasionsBox CRM (payment itself already succeeded)
            if (CRM_CONFIG.enabled && CRM_CONFIG.apiUrl) {
              var qty = parseInt(document.getElementById('modalQty').value) || 1;
              var payerName = [payer.name && payer.name.given_name, payer.name && payer.name.surname]
                .filter(Boolean).join(' ');
              fetch(CRM_CONFIG.apiUrl + '/order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  productName: currentProduct.name,
                  amount: currentProduct.price * qty,
                  quantity: qty,
                  currency: 'USD',
                  paypalOrderId: data.orderID,
                  payerEmail: payer.email_address || '',
                  payerName: payerName,
                  status: 'paid'
                })
              })
              .then(function(res) {
                if (!res.ok) throw new Error('CRM order ingest failed: HTTP ' + res.status);
              })
              .catch(function(err) {
                console.error('Order recorded by PayPal but not by the CRM:', err);
                showToast('Order received — we\'ll confirm by email', 'success');
              });
            }
          });
        },
        onError: function(err) {
          showToast('Payment error. Please try again.', 'error');
        }
      }).render('#paypal-button-container');
    } else {
      container.innerHTML = '<p style="text-align:center;color:var(--muted);font-size:14px">Payment loading...</p>';
    }
  }

  window.closeModal = function() {
    document.getElementById('productModal').classList.remove('active');
    document.body.style.overflow = '';
  };

  // Close modal on overlay click
  var modalEl = document.getElementById('productModal');
  if (modalEl) modalEl.addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });

  // Close modal on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeModal();
  });

  // Wire all "View Details" buttons in the shop grid
  document.querySelectorAll('.shop-card-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var name = this.closest('.shop-card').querySelector('.shop-card-name').textContent;
      openModal(name);
    });
  });

  // Wire coverflow carousel items to open modal on double-click
  document.querySelectorAll('.carousel-item').forEach(function(item, i) {
    item.addEventListener('dblclick', function() {
      openModal(products[i].name);
    });
  });

  /* ─── Contact Form → CRM Lead ─── */
  var contactFormEl = document.getElementById('contactForm');
  if (contactFormEl) contactFormEl.addEventListener('submit', function(e) {
    e.preventDefault();
    var btn = document.getElementById('contactBtn');
    var name = document.getElementById('contactName').value.trim();
    var email = document.getElementById('contactEmail').value.trim();
    var message = document.getElementById('contactMessage').value.trim();
    var honeypot = document.getElementById('contactWebsite').value;

    if (!name || !email) return;

    btn.classList.add('btn-loading');
    btn.textContent = 'Sending...';

    fetch(CRM_CONFIG.apiUrl + '/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        emailAddress: email,
        description: message,
        website: honeypot,
        source: 'web_form'
      })
    })
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      showToast('Message sent! We\'ll get back to you soon.', 'success');
      document.getElementById('contactForm').reset();
    })
    .catch(function(err) {
      console.error('Contact form submit failed:', err);
      showToast('Something went wrong — email Hello@occasionsbox.com', 'error');
    })
    .finally(function() {
      btn.classList.remove('btn-loading');
      btn.textContent = 'Send Message';
    });
  });

  /* ─── Newsletter Form → CRM Newsletter ─── */
  var newsletterFormEl = document.getElementById('newsletterForm');
  if (newsletterFormEl) newsletterFormEl.addEventListener('submit', function(e) {
    e.preventDefault();
    var btn = document.getElementById('newsletterBtn');
    var email = document.getElementById('newsletterEmail').value.trim();
    var honeypot = document.getElementById('newsletterWebsite').value;

    if (!email) return;

    btn.classList.add('btn-loading');
    btn.textContent = 'Subscribing...';

    fetch(CRM_CONFIG.apiUrl + '/newsletter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, website: honeypot })
    })
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      showToast('Subscribed! Welcome to the list.', 'success');
      document.getElementById('newsletterForm').reset();
    })
    .catch(function(err) {
      console.error('Newsletter signup failed:', err);
      showToast('Something went wrong — email Hello@occasionsbox.com', 'error');
    })
    .finally(function() {
      btn.classList.remove('btn-loading');
      btn.textContent = 'Subscribe';
    });
  });

  /* ─── Concierge Billing Toggle ─── */
  window.toggleBilling = function(mode) {
    document.querySelectorAll('.concierge-toggle-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.billing === mode);
    });
    document.querySelectorAll('.concierge-price').forEach(function(el) {
      el.textContent = el.dataset[mode];
    });
    document.querySelectorAll('.concierge-annual').forEach(function(el) {
      el.textContent = el.dataset[mode];
    });
    document.querySelectorAll('.concierge-period').forEach(function(el) {
      el.textContent = mode === 'annual' ? 'per month (billed annually)' : 'per month';
    });
  };

  /* ─── ScrollTrigger refresh after load ─── */
  window.addEventListener('load', function() {
    ScrollTrigger.refresh();
  });

})();
