(function() {
  /* The animation library loads from a CDN. If it is unavailable, stub it out
     so forms, the modal and the shop grid still work and no content stays
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

  /* ─── Shop occasion filter ─── */
  var shopFilters = document.querySelectorAll('.shop-filter');
  if (shopFilters.length) {
    var shopCards = document.querySelectorAll('.shop-card');
    var shopEmpty = document.getElementById('shopEmpty');
    shopFilters.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var want = btn.dataset.filter;
        shopFilters.forEach(function(b) { b.classList.toggle('active', b === btn); });
        var shown = 0;
        shopCards.forEach(function(card) {
          var tags = (card.dataset.occasion || '').split(' ');
          var match = want === 'all' || tags.indexOf(want) !== -1;
          card.hidden = !match;
          /* Cards below the fold are still parked at opacity 0 waiting on their
             scroll reveal. Filtering can bring one into view without the
             trigger ever firing, so settle them the moment we filter. */
          card.style.opacity = '1';
          card.style.transform = 'none';
          if (match) shown++;
        });
        if (shopEmpty) shopEmpty.hidden = shown > 0;
        if (window.ScrollTrigger && ScrollTrigger.refresh) ScrollTrigger.refresh();
      });
    });
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
  /* What is actually inside each box. The live site lists this per product
     and the rebuild had replaced it with one generic sentence repeated 22
     times, which is the whole argument for the price. Boxes not yet listed
     here fall back to that sentence until their contents are supplied. */
  var PRODUCT_CONTENTS = {
    "Love You": ["<b>Leather Wristlet</b> | Camel", "<b>Twin Sparrow</b> | \u201cLove You\u201d script keychain", "<b>Ramona &amp; Ruth</b> | Soft blush slim notebook", "<b>Vinoos</b> | Vegan wine gummies, 13 units | no alcohol, gluten, fat, nuts, gelatine or lactose", "<b>P.F. Candle Co.</b> | Soy candle, 7.2oz | Sunbloom", "<b>OB</b> | Mini signature matches, white tip", "<b>OB</b> | Gold ballpoint pen", "Occasions Box keepsake box | 11\u2033 &times; 8.66\u2033 &times; 4.33\u2033", "A handwritten card of your choice"],
    "Peaches & Cream": ["<b>Towel</b> | Hand-loomed Turkish hand or face towel | coral and white", "<b>Uber Star</b> | Reusable glass travel coffee cup, 12oz | silicone sleeve and matching lid in blush pink", "<b>OB Bath Sponge</b> | Fee sea sponge", "<b>Candlefolk</b> | Gold travel candle, 4oz | Juniper &amp; Mint", "<b>Fruition Chocolate Works</b> | Vanilla bean toasted white | Dominican chocolate, 38% cocoa", "<b>OB</b> | Mimi matches, red tip", "Occasions Box keepsake box | 11\u2033 &times; 8.66\u2033 &times; 4.33\u2033", "A handwritten card of your choice"],
    "Host's Delight": ["<b>Madeira Housewares</b> | Teak edge-grain chop block, 8\u2033 &times; 8\u2033 &times; 1.25\u2033", "<b>OB x Beautea Studio</b> | Organic rose mint loose-leaf tea", "<b>The Bee Box</b> | Mini specialty honey jar, 4oz | USDA certified organic", "<b>Three Blue Birds</b> | Swedish dishcloths, 2 count | absorbs 20&times; its weight, replaces 17 rolls of paper towels | 70% FSC cellulose, 30% organic cotton", "<b>OB Coffee Scoop</b> | 304 stainless measuring scoop with bag clip", "<b>OB</b> | Wooden honey dipper", "Occasions Box keepsake box | 11\u2033 &times; 8.66\u2033 &times; 4.33\u2033", "A handwritten card of your choice"]
  };

  var allProducts = [
    {name:'Love You', price:150, img: '/assets/img/OB0_7441-750w.jpg'},
    {name:'Peaches & Cream', price:132, img: '/assets/img/OB0_7537-750w.jpg'},
    {name:'Spa Weekend', note:"Contains eucalyptus mint body wash and lemon curd biscuits.", price:120, img: '/assets/img/OB0_7721-750w.jpg'},
    {name:'Coffee Lover', price:145, img: '/assets/img/OB0_7584-750w.jpg'},
    {name:'The Reset', price:145, img: '/assets/img/OB0_7512-750w.jpg'},
    {name:'The Dinner Party', note:"Contains almond cookies (tree nuts).", price:175, img: '/assets/img/0B0_5612-750w.jpg'},
    {name:"Host's Delight", price:105, img: '/assets/img/0B0_5453-750w.jpg', variants:[{label:'Rose', img:'/assets/img/0B0_5453-750w.jpg', tea:'<b>OB x Beautea Studio</b> | Organic rose mint loose-leaf tea'},{label:'Green', img:'/assets/img/OB_0299-750w.jpg', tea:'<b>OB x Beautea Studio</b> | Organic chamomile loose-leaf tea'}]},
    {name:'The Nightcap', note:"Contains almond cookies (tree nuts).", price:120, img: '/assets/img/0B0_5067-750w.jpg'},
    {name:'Lemonade', price:120, img: '/assets/img/0B0_5827-750w.jpg'},
    {name:'Bright Side', price:105, img: '/assets/img/0B0_5699-750w.jpg'},
    {name:'Cheers', price:145, img: '/assets/img/0B0_4910-750w.jpg'},
    {name:'Everyday Luxe', price:150, img: '/assets/img/0B0_5137-750w.jpg'},
    {name:'Welcome Home', price:125, img: '/assets/img/0B0_5183-750w.jpg'},
    {name:'The New Keys', price:170, img: '/assets/img/0B0_4712-750w.jpg'},
    {name:'The Valet', price:150, img: '/assets/img/_MG_1812-750w.jpg'},
    {name:'Goodnight', price:130, img: '/assets/img/ob_1471-750w.jpg'},
    {name:'Uncorked', price:120, img: '/assets/img/0B0_2489-750w.jpg'},
    {name:'The Wind Down', price:150, img: '/assets/img/_MG_1792-750w.jpg'},
    {name:'Mini Spa Day', note:"Contains essential oils and a clay mask. Not suitable as a gift for someone who is pregnant or nursing \u2014 tell us and we will swap the bath products for something safe.", price:115, img: '/assets/img/IMG_9325-750w.jpg'},
    {name:'First Night In', price:110, img: '/assets/img/ob_6944-750w.jpg'},
    {name:'Afternoon Tea', note:"Contains almond cookies (tree nuts).", price:128, img: '/assets/img/IMG_9730-750w.jpg'}
  ];

  var currentProduct = null;
  var currentVariant = null;

  /* The colourway is part of what someone bought, so it travels with the
     order to PayPal and to the CRM, not just the picture on screen. */
  function orderName() {
    if (!currentProduct) return '';
    return currentProduct.name + (currentVariant ? ' \u2014 ' + currentVariant.label : '');
  }

  function openModal(productName) {
    var product = allProducts.find(function(p) { return p.name === productName; });
    if (!product) return;
    currentProduct = product;

    document.getElementById('modalImg').src = product.img;
    document.getElementById('modalImg').alt = product.name;
    document.getElementById('modalName').textContent = product.name;
    document.getElementById('modalPrice').textContent = '$' + product.price.toFixed(2);
    document.getElementById('modalQty').value = 1;

    var caution = document.getElementById('modalCaution');
    if (caution) {
      caution.textContent = product.note || '';
      caution.hidden = !product.note;
    }

    currentVariant = (product.variants && product.variants[0]) || null;

    var vwrap = document.getElementById('modalVariants');
    if (vwrap) {
      if (product.variants && product.variants.length) {
        vwrap.innerHTML = '<div class="modal-variants-label">Choose your colour</div>' +
          product.variants.map(function(v, i) {
            return '<button type="button" class="modal-variant' + (i === 0 ? ' active' : '') +
                   '" data-variant="' + i + '">' + v.label + '</button>';
          }).join('');
        vwrap.hidden = false;
        vwrap.querySelectorAll('.modal-variant').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var v = product.variants[parseInt(this.dataset.variant, 10)];
            if (!v) return;
            currentVariant = v;
            vwrap.querySelectorAll('.modal-variant').forEach(function(b) {
              b.classList.toggle('active', b === btn);
            });
            document.getElementById('modalImg').src = v.img;
            document.getElementById('modalImg').alt = orderName();
            renderContents(product);
          });
        });
      } else {
        vwrap.hidden = true;
        vwrap.innerHTML = '';
      }
    }

    renderContents(product);
    mountCheckout();
  }

  /* The tea is the one line that differs between the colourways. */
  function renderContents(product) {
    var contents = PRODUCT_CONTENTS[product.name];
    if (contents && currentVariant && currentVariant.tea) {
      contents = contents.slice();
      contents[1] = currentVariant.tea;
    }
    var list = document.getElementById('modalContents');
    var desc = document.getElementById('modalDesc');
    if (list) {
      if (contents && contents.length) {
        list.innerHTML = '<div class="modal-contents-title">Box includes</div><ul>' +
          contents.map(function(item) { return '<li>' + item + '</li>'; }).join('') + '</ul>';
        list.hidden = false;
        if (desc) desc.hidden = true;
      } else {
        list.hidden = true;
        if (desc) desc.hidden = false;
      }
    }

  }

  function mountCheckout() {
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
              description: orderName() + ' Gift Box',
              amount: {
                value: (currentProduct.price * qty).toFixed(2),
                currency_code: 'USD',
                breakdown: {
                  item_total: { value: (currentProduct.price * qty).toFixed(2), currency_code: 'USD' }
                }
              },
              items: [{
                name: orderName(),
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
                  productName: orderName(),
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

  /* ─── Contact Form → CRM Lead ─── */
  var contactFormEl = document.getElementById('contactForm');
  if (contactFormEl) contactFormEl.addEventListener('submit', function(e) {
    e.preventDefault();
    var btn = document.getElementById('contactBtn');
    var err = document.getElementById('contactError');
    var val = function(id) {
      var el = document.getElementById(id);
      return el ? el.value.trim() : '';
    };

    var first   = val('contactFirst');
    var last    = val('contactLast');
    var email   = val('contactEmail');
    var phone   = val('contactPhone');
    var company = val('contactCompany');
    var qty     = val('contactQty');
    var budget  = val('contactBudget');
    var message = val('contactMessage');
    var honeypot = val('contactWebsite');

    var occasions = [];
    contactFormEl.querySelectorAll('input[name="occasion"]:checked')
      .forEach(function(c) { occasions.push(c.value); });

    var missing = [];
    if (!first) missing.push('first name');
    if (!last) missing.push('last name');
    if (!email) missing.push('email');
    if (!qty) missing.push('how many gifts');
    if (!budget) missing.push('budget per gift');
    if (!message) missing.push('what you have in mind');
    if (missing.length) {
      if (err) {
        err.textContent = 'Please fill in: ' + missing.join(', ') + '.';
        err.hidden = false;
      }
      return;
    }
    if (err) err.hidden = true;

    /* The CRM's lead endpoint takes a single free-text description, so the
       structured answers are folded into it as labelled lines rather than
       lost. Whoever picks the lead up reads them in one block. */
    var description = [
      occasions.length ? 'Occasion: ' + occasions.join(', ') : null,
      qty ? 'Quantity: ' + qty : null,
      budget ? 'Budget per gift: ' + budget : null,
      '',
      message
    ].filter(function(line) { return line !== null; }).join('\n');

    btn.classList.add('btn-loading');
    btn.textContent = 'Sending...';

    fetch(CRM_CONFIG.apiUrl + '/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: first,
        lastName: last,
        emailAddress: email,
        phone: phone,
        company: company,
        description: description,
        website: honeypot,
        source: 'web_form'
      })
    })
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      showToast('Request sent. We\'ll be in touch within one business day.', 'success');
      contactFormEl.reset();
    })
    .catch(function(error) {
      console.error('Contact form submit failed:', error);
      showToast('Something went wrong — email Hello@occasionsbox.com', 'error');
    })
    .finally(function() {
      btn.classList.remove('btn-loading');
      btn.textContent = 'Submit Request';
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
