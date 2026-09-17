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

  /* ─── Reviews Marquee ───
     Duplicate the cards so translateX(-50%) lands on an identical frame and
     the loop has no visible seam. The clone is hidden from screen readers so
     the same five reviews are not announced twice. */
  var reviewsTrack = document.getElementById('reviewsTrack');
  if (reviewsTrack && reviewsTrack.children.length) {
    var reviewClones = Array.prototype.slice.call(reviewsTrack.cloneNode(true).children);
    reviewClones.forEach(function(card) {
      card.setAttribute('aria-hidden', 'true');
      reviewsTrack.appendChild(card);
    });
    /* Only scroll once the second copy is in place; translateX(-50%) on a
       single copy would loop mid-card. */
    reviewsTrack.classList.add('is-looped');
  }

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
  /* What is actually inside each box, lifted from the per-product pages on
     the live site. Boxes were matched to those pages by hero photograph, not
     by name, because the rebuild renamed most of them. Any box absent here
     falls back to the generic sentence. */
  var PRODUCT_CONTENTS = {
    "Love You": ["<b>Leather Wristlet</b> | Camel color", "<b>Twin Sparrow</b> | “Love You” Script Keychain", "<b>Ramona & Ruth</b> | Soft Blush Slim Notebook", "<b>Vinoos</b> | 100% Vegan | The wine gummies are suitable for vegetarians and vegans and without artificial colors. They are free of alcohol, gluten, fat, nuts, gelatine and lactose. 13 units", "<b>P.F. Candle Co.</b> | Soy Candle | 7.2 oz | Sunbloom scent", "<b>OB</b> | Mini signature matches - white tip", "<b>OB</b> | Gold ballpoint pen", "Occasions Box Keepsake box | measures 11” x 8.66” x 4.33”", "A Complimentary Handwritten card of your choice"],
    "Peaches & Cream": ["<b>Towel</b> | Hand-loomed Turkish hand or face towel | Coral and White", "<b>Uber Star</b> | Reusable Glass Travel Coffee Cup | 12oz | Silicone Sleeve and Matching Lid in Blush Pink", "<b>OB Bath Sponge</b> | Fee Sea Sponge", "<b>Candlefolk</b> | Gold Travel Candle | Juniper & Mint | 4oz", "<b>Fruition Chocolate Works</b> | Vanilla Bean Toasted White | Dominican Chocolate | 38% Cocoa", "<b>OB</b> | Mimi Matches | Red Tip", "Occasions Box Keepsake box | measures 11” x 8.66” x 4.33”", "A Complimentary Handwritten card of your choice"],
    "Spa Weekend": ["<b>Towel</b> | Hand-Loomed Hand or Face Turkish Towel | Lime and White color", "<b>Long Wknd</b> | Body wash soap | Eucalyptus Mint", "<b>Candlefish</b> | No. 40 Gold Tin Soy Candle 7.5 oz | 40-50 Hours Burn Time | Rose, Lavender, Leather notes.", "<b>OB Mini Matches</b> | Green tip matches", "<b>Lady Joseph</b> | Delicate Lemon Curd Biscuits | Hand crafted in Spain using only natural ingredients | 3.5oz", "Occasions Box Keepsake box | measures 11” x 8.66” x 4.33”", "A Complimentary Handwritten card of your choice"],
    "Coffee Lover": ["<b>The Katy Cup</b> | Clear double insulated mug", "<b>Fruition Chocolate Works</b> | 100% Dark Chocolate | Dominican & Peru | 100% Cocoa", "<b>Erin Flett</b> | Oatmeal Dandelion Linen Tea Towel | 100% Linen", "<b>Oliver Pluff & Co.</b> | Colonial Blend Coffee", "<b>Benjamin Soap Co.</b> | Soy and Coconut Travel Candle | Cashmere Scent | 4 oz | 25 hour burn-time", "<b>Bali Harvest</b> | Round Teak Bowl Wooden Spoon", "Occasions Box Keepsake box | measures 11” x 8.66” x 4.33”", "A Complimentary Handwritten card of your choice"],
    "The Reset": ["<b>Candlefish</b> | No. 70 Gold Tin with Embossed Lid (Dep Grey) | Soy Candle | Burn Time 40-50 hours | 7 oz", "<b>W&P</b> | Insulated Ceramic Stainless Steel Coffee & Drink Bottle 16oz", "<b>Meera Lester Planner</b> | The Self-care planner a weekly guide to prioritize you", "<b>OB by Beautea Studio</b> | Wildflower Organic Facial Steam", "<b>OB Mini Matches</b> | Grey/Blue tip matches", "Occasions Box Keepsake box | measures 11” x 8.66” x 4.33”", "A Complimentary Handwritten card of your choice"],
    "The Dinner Party": ["<b>W&P | Host Book</b> | Host is a modern guide to eating, drinking and entertaining. From intimate weeknight dinners to festive large-scale gatherings, Eric and Josh show how to be a better host with inspired-yet-approachable recipes and advice for creating delicious meals and unforgettable experiences .", "<b>Erin Flett</b> | Sun Tea Towel | luxuriously absorbent woven flour sack cotton | can also be used for drying dishes | 26\" x 28\"", "<b>Viski Belmont Gold Plated Knife Set</b> | A sophisticated set of three mirror-plated gold cheese knives. Set features a small cleaver for hard cheeses, a perforated blade for soft cheese and a fork-tipped spear knife for breaking apart crumbly cheese.---Stainless steel--Gold mirror finish--Set of 3", "<b>Lifetime Leather Co</b> | Leather Coasters (set of 4)", "<b>Jocelyn & Co.</b> | The Luxe Collection Almond Cookies | Almond cookies are soft, sour, and lightly drizzled with a cream cheese frosting. (6 oz)", "Occasions Box Keepsake box | measures 11” x 8.66” x 4.33”", "A Complimentary Handwritten card of your choice"],
    "The Nightcap": ["<b>P.F. Candle Co.</b> | Soy Candle | 7.2 oz | Sunbloom scent", "<b>Lifetime Leather Co</b> | Leather Coasters (set of 4)", "<b>Grenville Society</b> | Antiqued Gold Pineapple Corkscrew. The pineapple has long been recognized as a symbol of hospitality, friendship and warm welcome", "<b>Jocelyn & Co</b>. | Almond Cookies finished with powdered sugar | 5.3 oz", "<b>OB</b> | Mini signature matches - red tip", "Occasions Box Keepsake box | measures 11” x 8.66” x 4.33”", "A Complimentary Handwritten card of your choice"],
    "Lemonade": ["<b>Madeira Housewares</b> | Teak-Edge Grain Chop Block S | 8” x 8” x 1.25”", "<b>OB x Beautea Studio</b> | Organic Lavender Earl Grey Loose-leaf Tea", "<b>Oliver Pluff & Co.</b> | Mocha Java Ground Gourmet Coffee | makes 8 cups", "<b>Three Blue Birds Swedish Dishcloth</b> | Sustainable, sturdy, and stylish dishcloths | Each cloth absorbs 20x its weight, replaces 17 rolls of paper towels | 70% cellulose (FSC-Certified). 30% organic cotton (FairTrade & GOTS) (2 count)", "<b>OB</b> <b>Coffee Scoop</b> | Food grade 304 Stainless Steel Ground Coffee Measuring Spoon/Scoop with Bag Clip.", "Occasions Box Keepsake box | measures 11” x 8.66” x 4.33”", "A Complimentary Handwritten card of your choice"],
    "Bright Side": ["Candlefish | No. 12 Yellow Tin with Embossed Lid (Yellow) | Soy Candle | Citrus Family with notes of Grapefruit, orange, lychee | Burn Time 40-50 hours | 7 oz", "<b>Fruition Chocolate Works</b> | Brown Butter Milk Chocolate | Dominican Chocolate | 43% Cacao", "<b>OB by Beautea Studio</b> | Wildflower Organic Facial Steam", "<b>OB Mini Matches</b> | <b>White tip matches</b> | Keepsake OB Wooden Box | measures 10” x 10” x 4”", "A Complimentary Handwritten card of your choice"],
    "Cheers": ["<b>Viski</b> | Faceted Crystal Champagne Glasses | Set of 2", "<b>Viski</b> | Gold Double Hinged Corkscrew<b></b> | This wine key features a double-hinged arm, five-turn worm and handle-integrated foil cutter - all plated in bona-fide 24-karat gold.", "<b>Candlefish</b> | No. 40 Gold Tin Soy Candle 7.5 oz | 40-50 Hours Burn Time | Rose, Lavender, Leather notes.", "<b>Vinoos</b> | 100% Vegan | The wine gummies are suitable for vegetarians and vegans and without artificial colors. They are free of alcohol, gluten, fat, nuts, gelatine and lactose. 13 uni", "<b>OB Mini Matches</b> | Red tip matchesKeepsake OB Wooden Box | measures 10” x 10” x 4”", "A Complimentary Handwritten card of your choice"],
    "Everyday Luxe": ["<b>Heathmade</b> | <b></b> | Relax lotion bar 2 oz | Sweet Orange + Ginger + Ylang Ylang", "<b>Sara Happ | Lip Scrub</b> | Vanilla Bean .5 oz | Eliminates dry, flaky skin, immediately leaving lips soft and supple. How to use: Massage onto lips using a firm, circular motion. Wipe away with a tissue.", "<b>Odeme</b> | Silk Charmeuse Pink Scrunchie", "<b>Odeme</b> | Pink compact mirror", "<b>Vinoos</b> | 100% Vegan | The wine gummies are suitable for vegetarians and vegans and without artificial colors. They are free of alcohol, gluten, fat, nuts, gelatine and lactose. 13 units", "<b>Keepsake hand-woven basket</b> | measures 9” x 5” x 3.25", "A Complimentary Handwritten card of your choice"],
    "Welcome Home": ["<b>Madeira Housewares</b> | Teak-Edge Grain Chop Block S | 8” x 8” x 1.25”", "<b>Erin Flett</b> | Oatmeal Dandelion Linen Tea Towel | 100% Linen", "<b>P.F. Candle Co.</b> | Sandalwood Rose - 3.5 oz Mini Soy | Made with 100% domestically grown soy wax, fine fragrance oils, and cotton-core wicks. Paraben-free, phthalate-free, and never (ever) tested on animals.", "<b>Oliver Pluff & Co.</b> | Earl Grey Tea (20 tea bags)", "<b>OB</b> <b>Coffee Scoop</b> | Gold Plated with clip", "Occasions Box Keepsake box | measures 11” x 8.66” x 4.33”", "A Complimentary Handwritten card of your choice"],
    "The New Keys": ["<b>Madeira Housewares</b> | Teak-Edge Grain Chop Block S | 8” x 8” x 1.25”", "<b>Erin Flett</b> | Sun Tea Towel | luxuriously absorbent woven flour sack cotton | can also be used for drying dishes | 26\" x 28\"", "<b>Lifetime Leather Co</b> | Leather Coasters (set of 4)", "<b>Grenville Society</b> | Antiqued Gold Pineapple Corkscrew. The pineapple has long been recognized as a symbol of hospitality, friendship and warm welcome", "<b>P.F. Candle Co.</b> | Soy Candle | 7.2 oz | Sunbloom scent", "<b>The Homebody Society</b> | Pineapple - Beechwood Serving Spoon | 12 inches", "<b>The Homebody Society</b> | Home Sweet Home Wooden Key Tag", "Occasions Box Keepsake box | measures 11” x 8.66” x 4.33”", "A Complimentary Handwritten card of your choice"],
    "The Valet": ["<b>EgorStore</b> | Personalized leather valet tray, catchall tray, storage tray", "<b>BeyBerk International</b> | Stainless Steel Guillotine Cigar Cutter with Pouch", "<b>Corkcicle</b> | Triple Insulated Stainless Steel Travel Mug | 16 oz | Includes Clear Lid", "<b>Heathmade</b> | <b></b> | Mainly lotion bar 2 oz | Bayleaf, Tobaco and Lavender", "<b>TC Chocolate</b> | Cardamon Krumkake 77% Dark Chocolate | 2 oz", "Keepsake OB Wooden Box with lid | measures 10” x 10” x 4", "A Complimentary Handwritten card of your choice"],
    "Goodnight": ["<b>P.F. Candle Co.</b> | Soy Candle | 7.2 oz | Sunbloom scent", "<b>Sara Happ | Lip Scrub</b> | Vanilla Bean .5 oz | Eliminates dry, flaky skin, immediately leaving lips soft and supple. How to use: Massage onto lips using a firm, circular motion. Wipe away with a tissue.", "<b>Vinoos</b> | 100% Vegan | The wine gummies are suitable for vegetarians and vegans and without artificial colors. They are free of alcohol, gluten, fat, nuts, gelatine and lactose. 13 units", "<b>Beautea</b> | Organic Full Leaf Tea | Chamomile | 1.5 oz/43g", "<b>Louvelle Silk Eye Mask</b> | This luxury padded eye mask made from high quality cotton silk has a soft, cool feel on the skin.", "Occasions Box Keepsake box | measures 11” x 8.66” x 4.33”", "A Complimentary Handwritten card of your choice"],
    "Uncorked": ["<b>Candlefish</b> | No. 67 Molded Metal | 7 oz Soy Candle | Fragrance: Bergamot, Lemon, Ylang | 45 hours burn time", "<b>Viski</b> | Belmont: Gold Plated Signature Corkscrew<b></b> | This wine key features a double-hinged arm, five-turn worm and handle-integrated foil cutter - all plated in bona-fide 24-karat gold.", "<b>Lifetime Leather Co.</b> | Leather Coasters (set of 4) | Black", "<b>Dick Taylor Craft Chocolate</b> | Fleur De Sel 73% Dark Chocolate | 2 oz", "Keepsake OB Wooden Box | measures 10” x 10” x 4”", "A Complimentary Handwritten card of your choice"],
    "The Wind Down": ["<b>Corkcicle</b> | Triple Insulated Stainless Steel Travel Mug | 16 oz | Includes Clear Lid", "<b>Leather journal</b> | 160 pages", "<b>Lifetime Leather Co</b> | Leather Coasters (set of 4)", "<b>OB X Beautea</b> | Organic Full Leaf Tea | Chamomile | 1.5 oz/43g", "<b>Heathmade</b> | Can-do Hand Sanitizer | 1 oz", "<b>Ubrands</b> | Classic Gold/Black Catalina Felt Tip Pen", "Keepsake hand-woven basket | measures 10” x 10” x 4", "A Complimentary Handwritten card of your choice"],
    "Mini Spa Day": ["<b>Ona New York</b> | Airplane Mode, intense hydration gel mask | Hyaluronic Acid and Betaglucan replenish skin moisture barrier and prevent hydration loss. | CoQ10 and Camellia Japonica enhance skin elasticity for visibly plumped and energized skin. | Contains NO sulfates / parabens / formaldehyde / artificial coloring / dimethicone / mineral oil / phthalateEye Mask Hawaiian Bird Of Paradise | Luxury padded eye mask made from high quality cotton silk feel has a soft, cool feel on the skin. Designed with directional prints and soft adjustable elastic for a comfortable fit.", "<b>Lola Jane Naturals</b> | Fizzing Bath Cube | Pure Sodium Bicarbonate, cornstarch, pure Epsom salt, non-gmo food grade citric acid, Essential Oils*, unrefined virgin coconut oil*, distilled water. (*organic) | Please research essential oils prior to purchase, if pregnant. Some essential oils should be avoided during pregnancy or while nursing.", "<b>Lola Jane Naturals</b> | Earth clay mask treatments are for all skin types. Rose Kaolin Clay mask, with soothing colloidal oatmeal and essential oils, gently exfoliates and cleanses while absorbing impurities and leaving your skin feeling smooth, tight and clean. For sensitive, dry or mature skin. Ingredients (Vegan): Rose Kaolin Clay, Colloidal Oats*, Rosehip Seed Oil*, pure Rose, Sandalwood* and Geranium* Essential Oils", "<b>Goodnight Darling Co.</b> | Bath Salt pouch", "<b>Vinoos</b> | 100% Vegan | The wine gummies are suitable for vegetarians and vegans and without artificial colors. They are free of alcohol, gluten, fat, nuts, gelatine and lactose. 13 units", "<b>Ramona & Ruth</b> | Soft Blush Slim Notebook | Toss in your bag for notes and lists on the go or slip into your desk drawer. The conveniently sized Slim Notebook is accented with gold foil on its luxuriously thick cover. 100 unlined pages | Size: 3\" x 5 1/4\" | Printing type: gold foilMade in United States of America.", "<b>Gold Bullet Ballpoint Pen</b>", "Keepsake hand-woven basket | measures 9” x 5” x 3.25", "A Complimentary Handwritten card of your choice"],
    "First Night In": ["<b>Occasion Box</b> | Midnight Black Luxury candle | Exotic musk finely scented, Coconut and Soy wax blend | 36-40 hours burning time | net wt. 6.4 oz", "<b>Teaspressa</b> | Green Gold tea pouch | 6 oz loose leaf tea | Rich and earthy with smoky notes.", "<b>Dick Taylor Craft Chocolate</b> | Fleur De Sel 73% Dark Chocolate | 2 oz", "<b>OB</b> | Coffee/Tea Scoop | Gold Plated with clip", "<b>OB</b> | Black Tip Signature Matches", "Occasions Box Keepsake box | measures 11” x 8.66” x 4.33”", "A Complimentary Handwritten card of your choice"],
    "Afternoon Tea": ["<b>Candlefish</b> | No. 31 Gold Tin Candle 7.05 oz | Fragrance Notes: Cedarwood, Elemi, Lime, Leather, Amber | Fragrance Family - WOOD | Soy Burn Time: 40-50 Hours", "<b>Candlefish</b> | Gold Scales 4” Safety Matches (45 count)", "<b>Candlefish</b> | Wood Plate | This wooden plate is the perfect resting place for your candles or an overall catch-all.", "<b>Erin Flett</b> | Chocolate Dandelion Oatmeal Linen Tea Towel of the highest quality | heavy canvas, hand-printed and sewn | 9 1/2\" x 4\" x 5\"", "<b>OB x Beautea Studio</b> | Organic Chamomile Loose-leaf Tea", "<b>The Bee Box</b> | Mini Specialty Honey Jar | 4 oz of pure honey USDA Certified Organic", "<b>Jocelyn & Co</b> | The Luxe Collection Almond Cookies | Almond cookies finished with powdered sugar. Crunchy and very addicting. Size: 6 oz. Made in United States of America", "Occasions Box Keepsake box | measures 11” x 8.66” x 4.33”", "A Complimentary Handwritten card of your choice"],
    "Host's Delight": ["<b>Madeira Housewares</b> | Teak-Edge Grain Chop Block S | 8” x 8” x 1.25”", "<b>OB x Beautea Studio</b> | Organic Rose Mint Loose-leaf Tea", "<b>The Bee Box</b> | Mini Specialty Honey Jar | 4 oz of pure honey USDA Certified Organic", "<b>Three Blue Birds Swedish Dishcloth</b> | Sustainable, sturdy, and stylish dishcloths | Each cloth absorbs 20x its weight, replaces 17 rolls of paper towels | 70% cellulose (FSC-Certified). 30% organic cotton (FairTrade & GOTS) (2 count)", "<b>OB</b> <b>Coffee Scoop</b> | Food grade 304 Stainless Steel Ground Coffee Measuring Spoon/Scoop with Bag Clip.", "<b>OB</b> | Wooden Honey Dipper", "Occasions Box Keepsake box | measures 11” x 8.66” x 4.33”", "A Complimentary Handwritten card of your choice"]
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
    return currentProduct.name + (currentVariant ? ' — ' + currentVariant.label : '');
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* A photograph of an open box shows what is inside it; a photograph of the
     closed box shows what arrives on the doorstep. Buyers want both, so a
     product may carry several images. `images` is a list of paths, or of
     {src, alt} where the alt says what the shot actually shows ("the box
     closed, ribboned"). One image and the strip stays out of the way. */
  function normaliseImages(list, label) {
    return (list || []).map(function(entry, i) {
      var src = typeof entry === 'string' ? entry : (entry && entry.src) || '';
      var alt = typeof entry === 'string' ? '' : (entry && entry.alt) || '';
      return {
        src: src,
        alt: alt ? label + ' — ' + alt : (i === 0 ? label + ' gift box' : label + ' gift box, another view')
      };
    }).filter(function(img) { return img.src; });
  }

  /* A colourway carries its own photographs where it has them; otherwise the
     product's own set stands in. */
  function galleryFor(product, variant) {
    var label = product.name + (variant ? ' \u2014 ' + variant.label : '');
    if (variant && variant.images) return normaliseImages(variant.images, label);
    if (variant && variant.img) return normaliseImages([variant.img], label);
    if (product.images) return normaliseImages(product.images, label);
    return normaliseImages([product.img], label);
  }

  function renderGallery(product) {
    var images = galleryFor(product, currentVariant);
    var main = document.getElementById('modalImg');
    var strip = document.getElementById('modalThumbs');
    if (!main || !images.length) return;

    var show = function(i) {
      main.src = images[i].src;
      main.alt = images[i].alt;
      if (!strip) return;
      strip.querySelectorAll('.modal-thumb').forEach(function(t, j) {
        t.classList.toggle('active', j === i);
        t.setAttribute('aria-current', j === i ? 'true' : 'false');
      });
    };

    if (strip) {
      if (images.length > 1) {
        strip.innerHTML = images.map(function(img, i) {
          return '<button type="button" class="modal-thumb' + (i === 0 ? ' active' : '') + '" data-img="' + i +
                 '" aria-label="Show ' + escapeHtml(img.alt) + '"><img src="' + escapeHtml(img.src) +
                 '" alt="" loading="lazy"></button>';
        }).join('');
        strip.hidden = false;
        strip.querySelectorAll('.modal-thumb').forEach(function(btn) {
          btn.addEventListener('click', function() { show(parseInt(this.dataset.img, 10)); });
        });
      } else {
        strip.hidden = true;
        strip.innerHTML = '';
      }
    }
    show(0);
  }

  function openModal(productName) {
    var product = allProducts.find(function(p) { return p.name === productName; });
    if (!product) return;
    currentProduct = product;

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
            renderGallery(product);
            renderContents(product);
          });
        });
      } else {
        vwrap.hidden = true;
        vwrap.innerHTML = '';
      }
    }

    renderGallery(product);
    renderContents(product);
    document.getElementById('productModal').classList.add('active');
    document.body.style.overflow = 'hidden';
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

  /* ─── Cart ───
     Someone sending gifts is rarely sending one, so the shop has to let them
     keep shopping. The cart lives in this browser's localStorage: it is one
     shopper's own basket, we never read it back, and it survives a reload or
     a walk over to the About page.

     Only identity and quantity are stored. Price, photograph and contents are
     read from the catalogue on every render, so a cart left open for a month
     cannot check out at last month's price, and a box we have withdrawn
     quietly drops out instead of being sold. */
  var CART_KEY = 'ob_cart_v1';
  var MAX_QTY = 20;
  var MAX_LINES = 20;
  var cart = [];
  var paypalMounted = false;

  function readStoredCart() {
    try {
      var raw = window.localStorage.getItem(CART_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function(line) {
        return line && typeof line.name === 'string' &&
               typeof line.qty === 'number' && isFinite(line.qty) && line.qty >= 1;
      }).slice(0, MAX_LINES).map(function(line) {
        return {
          name: line.name,
          variant: typeof line.variant === 'string' ? line.variant : '',
          qty: Math.min(Math.round(line.qty), MAX_QTY)
        };
      });
    } catch (e) {
      // Private browsing, blocked storage, corrupted JSON — start empty.
      return [];
    }
  }

  function saveCart() {
    try {
      window.localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch (e) {
      // The cart still works for this page view; it just will not survive.
    }
  }

  function lineLabel(line) {
    return line.name + (line.variant ? ' — ' + line.variant : '');
  }

  /* The catalogue is the source of truth. A stored line that no longer
     matches a product, or a colourway we no longer carry, is dropped rather
     than guessed at. */
  function resolveCart() {
    var out = [];
    cart.forEach(function(line) {
      var product = allProducts.find(function(p) { return p.name === line.name; });
      if (!product) return;
      var variant = null;
      if (product.variants && product.variants.length) {
        variant = product.variants.find(function(v) { return v.label === line.variant; }) || null;
        if (!variant) return;
      }
      out.push({
        line: line,
        label: lineLabel(line),
        price: product.price,
        img: (variant && variant.img) || product.img
      });
    });
    return out;
  }

  /* Money adds up in cents. 132.00 * 3 in floats does not. */
  function subtotalCents(resolved) {
    return resolved.reduce(function(sum, r) {
      return sum + Math.round(r.price * 100) * r.line.qty;
    }, 0);
  }

  function money(cents) {
    return '$' + (cents / 100).toFixed(2);
  }

  function cartUnits(resolved) {
    return resolved.reduce(function(n, r) { return n + r.line.qty; }, 0);
  }

  function addToCart(product, variant, qty) {
    var variantLabel = variant ? variant.label : '';
    var existing = cart.find(function(l) {
      return l.name === product.name && (l.variant || '') === variantLabel;
    });
    if (existing) {
      existing.qty = Math.min(existing.qty + qty, MAX_QTY);
    } else {
      if (cart.length >= MAX_LINES) {
        showToast('That is as many different boxes as the cart holds. Email Collaborate@occasionsbox.com and we will quote the whole order.', 'error');
        return false;
      }
      cart.push({ name: product.name, variant: variantLabel, qty: Math.min(qty, MAX_QTY) });
    }
    saveCart();
    renderCart();
    return true;
  }

  function renderCart() {
    var resolved = resolveCart();
    var units = cartUnits(resolved);
    var overlay = document.getElementById('cartOverlay');

    var navCount = document.getElementById('navCartCount');
    if (navCount) {
      navCount.textContent = String(units);
      // A bubble reading "0" is noise; the bag on its own says the same thing.
      navCount.hidden = units === 0;
    }
    var navCart = document.getElementById('navCart');
    // On the shop page the cart stays in reach even when empty; elsewhere an
    // empty cart is a control with nothing behind it, so it stays out of view.
    if (navCart) navCart.hidden = units === 0 && !overlay;

    var list = document.getElementById('cartItems');
    if (!list) return;

    list.innerHTML = resolved.map(function(r, i) {
      var label = escapeHtml(r.label);
      return '<li class="cart-item" data-line="' + i + '">' +
        '<img class="cart-item-img" src="' + escapeHtml(r.img) + '" alt="" loading="lazy">' +
        '<div class="cart-item-main">' +
          '<div class="cart-item-name">' + label + '</div>' +
          '<div class="cart-item-unit">' + money(Math.round(r.price * 100)) + ' each</div>' +
          '<div class="cart-item-controls">' +
            '<button type="button" class="cart-step" data-act="dec" aria-label="One fewer ' + label + '">&minus;</button>' +
            '<span class="cart-item-qty">' + r.line.qty + '</span>' +
            '<button type="button" class="cart-step" data-act="inc" aria-label="One more ' + label + '">+</button>' +
            '<button type="button" class="cart-remove" data-act="remove">Remove</button>' +
          '</div>' +
        '</div>' +
        '<div class="cart-item-total">' + money(Math.round(r.price * 100) * r.line.qty) + '</div>' +
      '</li>';
    }).join('');

    var empty = document.getElementById('cartEmpty');
    var foot = document.getElementById('cartFoot');
    if (empty) empty.hidden = resolved.length > 0;
    if (foot) foot.hidden = resolved.length === 0;

    var subtotal = document.getElementById('cartSubtotal');
    if (subtotal) subtotal.textContent = money(subtotalCents(resolved));
  }

  function openCart() {
    var overlay = document.getElementById('cartOverlay');
    if (!overlay) return;
    renderCart();
    overlay.hidden = false;
    requestAnimationFrame(function() { overlay.classList.add('open'); });
    document.body.style.overflow = 'hidden';
    mountCheckout();
    var close = document.getElementById('cartClose');
    if (close) close.focus();
  }

  function closeCart() {
    var overlay = document.getElementById('cartOverlay');
    if (!overlay || overlay.hidden) return;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(function() {
      if (!overlay.classList.contains('open')) overlay.hidden = true;
    }, 260);
  }

  /* PayPal is told the whole cart, one item per line, with an item_total that
     matches the sum — so the payer's receipt lists what they actually bought
     and the CRM can reconcile against it line for line. */
  function mountCheckout() {
    var container = document.getElementById('paypal-button-container');
    if (!container || paypalMounted) return;

    if (typeof paypalSDK === 'undefined') {
      container.innerHTML = '<p class="cart-loading">Payment loading&hellip;</p>';
      return; // Not marked mounted: the next open retries.
    }

    paypalMounted = true;
    container.innerHTML = '';
    paypalSDK.Buttons({
      style: { layout: 'vertical', color: 'gold', shape: 'pill', label: 'pay', height: 45 },
      createOrder: function(data, actions) {
        var resolved = resolveCart();
        var total = (subtotalCents(resolved) / 100).toFixed(2);
        var units = cartUnits(resolved);
        var description = resolved.length === 1
          ? resolved[0].label + ' Gift Box'
          : 'Occasions Box — ' + units + ' gift boxes';
        return actions.order.create({
          purchase_units: [{
            description: description.slice(0, 127),
            amount: {
              value: total,
              currency_code: 'USD',
              breakdown: { item_total: { value: total, currency_code: 'USD' } }
            },
            items: resolved.map(function(r) {
              return {
                name: r.label.slice(0, 127),
                unit_amount: { value: r.price.toFixed(2), currency_code: 'USD' },
                quantity: String(r.line.qty),
                category: 'PHYSICAL_GOODS'
              };
            })
          }]
        });
      },
      onApprove: function(data, actions) {
        // Snapshot before capture: the cart is emptied on success, and what we
        // report to the CRM has to be what was actually paid for.
        var resolved = resolveCart();
        var cents = subtotalCents(resolved);
        return actions.order.capture().then(function(details) {
          closeCart();
          // Guest checkout / some funding sources return a payer without a name object.
          var payer = (details && details.payer) || {};
          var given = (payer.name && payer.name.given_name) || '';
          showToast('Order confirmed! Thank you' + (given ? ', ' + given : '') + '.', 'success');
          cart = [];
          saveCart();
          renderCart();
          recordOrder(data.orderID, payer, resolved, cents);
        });
      },
      onError: function(err) {
        showToast('Payment error. Please try again.', 'error');
      }
    }).render('#paypal-button-container');
  }

  /* Payment has already succeeded by the time this runs, so a CRM failure is
     reported to us and softened for the buyer, never treated as a failed sale. */
  function recordOrder(paypalOrderId, payer, resolved, cents) {
    if (!CRM_CONFIG.enabled || !CRM_CONFIG.apiUrl) return;
    var payerName = [payer.name && payer.name.given_name, payer.name && payer.name.surname]
      .filter(Boolean).join(' ');
    fetch(CRM_CONFIG.apiUrl + '/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: resolved.map(function(r) {
          return { name: r.label, unitAmount: r.price, quantity: r.line.qty };
        }),
        amount: cents / 100,
        currency: 'USD',
        paypalOrderId: paypalOrderId,
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

  window.closeModal = function() {
    document.getElementById('productModal').classList.remove('active');
    document.body.style.overflow = '';
  };

  // Close modal on overlay click
  var modalEl = document.getElementById('productModal');
  if (modalEl) modalEl.addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });

  // Escape closes whichever is on top.
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    var overlay = document.getElementById('cartOverlay');
    if (overlay && !overlay.hidden) { closeCart(); return; }
    closeModal();
  });

  // Wire all "View Details" buttons in the shop grid
  /* The photograph is the thing people reach for, so it opens the box as
     readily as the button does. The button stays for the keyboard. */
  document.querySelectorAll('.shop-card-btn, .shop-card-img').forEach(function(el) {
    el.addEventListener('click', function() {
      var name = this.closest('.shop-card').querySelector('.shop-card-name').textContent;
      openModal(name);
    });
  });

  var modalAdd = document.getElementById('modalAdd');
  if (modalAdd) modalAdd.addEventListener('click', function() {
    if (!currentProduct) return;
    var qty = parseInt(document.getElementById('modalQty').value, 10);
    if (!qty || qty < 1) qty = 1;
    if (qty > MAX_QTY) qty = MAX_QTY;
    if (!addToCart(currentProduct, currentVariant, qty)) return;
    closeModal();
    if (document.getElementById('cartOverlay')) {
      openCart();
    } else {
      showToast(orderName() + ' added to your cart.', 'success');
    }
  });

  var cartItemsEl = document.getElementById('cartItems');
  if (cartItemsEl) cartItemsEl.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var row = btn.closest('.cart-item');
    if (!row) return;
    var resolved = resolveCart();
    var entry = resolved[parseInt(row.dataset.line, 10)];
    if (!entry) return;
    var act = btn.dataset.act;
    if (act === 'inc') {
      entry.line.qty = Math.min(entry.line.qty + 1, MAX_QTY);
    } else if (act === 'dec') {
      entry.line.qty -= 1;
    }
    if (act === 'remove' || entry.line.qty < 1) {
      cart = cart.filter(function(l) { return l !== entry.line; });
    }
    saveCart();
    renderCart();
  });

  var cartCloseEl = document.getElementById('cartClose');
  if (cartCloseEl) cartCloseEl.addEventListener('click', closeCart);

  var cartContinueEl = document.getElementById('cartContinue');
  if (cartContinueEl) cartContinueEl.addEventListener('click', closeCart);

  var cartOverlayEl = document.getElementById('cartOverlay');
  if (cartOverlayEl) cartOverlayEl.addEventListener('click', function(e) {
    if (e.target === this) closeCart();
  });

  var navCartEl = document.getElementById('navCart');
  if (navCartEl) navCartEl.addEventListener('click', function(e) {
    // Where there is no drawer on this page, the link goes to the shop.
    if (!document.getElementById('cartOverlay')) return;
    e.preventDefault();
    openCart();
  });

  cart = readStoredCart();
  renderCart();
  if (cartOverlayEl && window.location.hash === '#cart') openCart();

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
      showToast('Thank you for your inquiry! We\'ll be in touch within two business days.', 'success');
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
