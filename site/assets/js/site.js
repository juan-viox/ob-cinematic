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
     The CRM lives on its own host, so this is cross-origin: the ingest
     routes answer the preflight and allow occasionsbox.com (crm/src/lib/ingest.ts).
     ═══════════════════════════════════════════ */
  var CRM_CONFIG = {
    apiUrl: 'https://crm.occasionsbox.com/api/v1/ingest',
    /* Stripe Checkout is hosted by Stripe; the CRM creates the session
       (it holds the secret key and prices the cart from the catalogue)
       and records the order when Stripe's webhook confirms payment. */
    stripeCheckoutUrl: 'https://crm.occasionsbox.com/api/v1/checkout/stripe',
    enabled: true
  };

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

  /* ─── The story per box ───
     A list of contents says what is in the box. It does not say who the box
     is for, which is the thing a buyer is actually deciding. Every box on the
     old site carried a short piece of prose before the list, and the rebuild
     dropped it; this is where it lives now.

     Each line is written from that box's real contents and nothing else. If a
     product changes, this changes with it. Keep them to two or three
     sentences: the list underneath does the detail. */
  var PRODUCT_STORIES = {
    "Love You": "The one to send when the words matter more than the occasion. A camel leather wristlet and a script keychain to carry, a blush notebook and a gold pen to write in, and a soy candle for the evening it gets opened.",
    "Peaches & Cream": "Soft coral and blush from start to finish. A hand-loomed Turkish towel and a sea sponge for a long morning, a glass travel cup for the walk out of the door, and Dominican white chocolate for somewhere in between.",
    "Spa Weekend": "Two days off, boxed. A hand-loomed Turkish towel and eucalyptus mint body wash for the bath, a gold tin candle to light beside it, and lemon curd biscuits for afterwards.",
    "Coffee Lover": "For the person who measures the morning in cups. Colonial Blend coffee from Oliver Pluff, a clear double-insulated mug to drink it from, a teak bowl and spoon, and 100% dark chocolate for the cup that needs it.",
    "The Reset": "A box about starting again. A self-care planner to lay out the week, an insulated bottle to keep beside it, wildflower facial steam for the evening, and a deep grey candle for the quiet part of it.",
    "The Dinner Party": "Everything the table needs except the guests. Three gold-plated cheese knives, leather coasters, a linen sun tea towel and a host book, finished with almond cookies for the board.",
    "Host's Delight": "The thank-you for whoever had everyone over. A teak edge-grain chopping block, organic loose-leaf tea, and a jar of the Bee Box's honey with a wooden dipper. Choose rose mint or chamomile.",
    "The Nightcap": "For the hour after the plates are cleared. An antique rose gold pineapple corkscrew, leather coasters, a soy candle and almond cookies, which is most of what a good nightcap asks for.",
    "Lemonade": "For when life hands them a great deal at once. A teak edge-grain chopping block, lavender Earl Grey and Mocha Java coffee, and Swedish dishcloths that outlast seventeen rolls of paper towels.",
    "Bright Side": "Small and yellow and meant to land on a hard day. A yellow tin Candlefish candle, brown butter milk chocolate and a wildflower facial steam, which is a good deal of comfort for a small box.",
    "Cheers": "For the promotion, the closing, the yes. Faceted crystal champagne glasses and a gold double-hinged corkscrew, a gold tin candle and wine gummies, in a keepsake wooden box.",
    "Everyday Luxe": "The small luxuries someone would never think to buy themselves. A silk charmeuse scrunchie and a compact mirror from Odeme, a lip scrub from Sara Happ, and wine gummies.",
    "Welcome Home": "The first box through a new door. A teak edge-grain chopping block and an oatmeal linen tea towel for the kitchen, Earl Grey and a gold coffee scoop, and a sandalwood rose candle for the first evening.",
    "The New Keys": "The housewarming box in full. A teak chopping block, leather coasters and an antique rose gold pineapple corkscrew for the first night hosting, then a beechwood serving spoon and a Home Sweet Home key tag to keep.",
    "The Valet": "For the top of the dresser and the drive in. A personalised leather valet tray for whatever comes out of his pockets, a triple-insulated travel mug, a stainless cigar cutter and 77% dark chocolate.",
    "Goodnight": "A box that only asks them to stop. A padded silk eye mask, organic full leaf tea and a soy candle, with a lip scrub and wine gummies for the way there.",
    "Uncorked": "Four things and a bottle, which is all an evening really needs. A gold-plated signature corkscrew, leather coasters, a moulded metal Candlefish candle and fleur de sel dark chocolate.",
    "The Wind Down": "For the person who is always the one holding it together. A 160-page leather journal and a gold felt tip pen, a triple-insulated travel mug, leather coasters and organic full leaf tea.",
    "Mini Spa Day": "An hour to themselves, in a hand-woven keepsake basket. A hydration gel mask, a rose kaolin clay mask, a fizzing bath cube and bath salts, with a blush notebook and a gold pen for whatever surfaces.",
    "First Night In": "Small, dark and calm, for the evening the boxes are still stacked in the hall. A midnight black candle with a 40 hour burn, Green Gold tea from Teaspressa, and fleur de sel dark chocolate.",
    "Afternoon Tea": "A whole afternoon, arranged. Organic chamomile, a jar of the Bee Box's honey and almond cookies from Jocelyn & Co, with a Candlefish No. 31 candle on its own wood plate."
  };

  var allProducts = [
    {name:"Love You", price:150, img: "/assets/img/OB0_7441-750w.jpg", images:[
      "/assets/img/OB0_7441-750w.jpg",
      "/assets/img/love-you-1-1500w.jpg",
      "/assets/img/love-you-2-1500w.jpg",
      "/assets/img/love-you-3-1500w.jpg",
      "/assets/img/love-you-4-1500w.jpg",
      "/assets/img/love-you-5-1500w.jpg"
    ]},
    {name:"Peaches & Cream", price:132, img: "/assets/img/OB0_7537-750w.jpg", images:[
      "/assets/img/OB0_7537-750w.jpg",
      "/assets/img/peaches-cream-1-1500w.jpg",
      "/assets/img/peaches-cream-2-1500w.jpg",
      "/assets/img/peaches-cream-3-1500w.jpg",
      "/assets/img/peaches-cream-4-1500w.jpg",
      "/assets/img/peaches-cream-5-1500w.jpg"
    ]},
    {name:"Spa Weekend", note:"Contains eucalyptus mint body wash and lemon curd biscuits.", price:120, img: "/assets/img/OB0_7721-750w.jpg", images:[
      "/assets/img/OB0_7721-750w.jpg",
      "/assets/img/spa-weekend-1-1500w.jpg",
      "/assets/img/spa-weekend-2-1500w.jpg",
      "/assets/img/spa-weekend-3-1500w.jpg",
      "/assets/img/spa-weekend-4-1500w.jpg",
      "/assets/img/spa-weekend-5-1500w.jpg"
    ]},
    {name:"Coffee Lover", price:145, img: "/assets/img/OB0_7584-750w.jpg", images:[
      "/assets/img/OB0_7584-750w.jpg",
      "/assets/img/coffee-lover-1-1500w.jpg",
      "/assets/img/coffee-lover-2-1500w.jpg",
      "/assets/img/coffee-lover-3-1500w.jpg",
      "/assets/img/coffee-lover-4-1500w.jpg",
      "/assets/img/coffee-lover-5-1500w.jpg"
    ]},
    {name:"The Reset", price:145, img: "/assets/img/OB0_7512-750w.jpg", images:[
      "/assets/img/OB0_7512-750w.jpg",
      "/assets/img/the-reset-1-1500w.jpg",
      "/assets/img/the-reset-2-1500w.jpg",
      "/assets/img/the-reset-3-1500w.jpg",
      "/assets/img/the-reset-4-1500w.jpg",
      "/assets/img/the-reset-5-1500w.jpg"
    ]},
    {name:"The Dinner Party", note:"Contains almond cookies (tree nuts).", price:175, img: "/assets/img/0B0_5612-750w.jpg", images:[
      "/assets/img/0B0_5612-750w.jpg",
      "/assets/img/the-dinner-party-1-1500w.jpg",
      "/assets/img/the-dinner-party-2-1500w.jpg",
      "/assets/img/the-dinner-party-3-1500w.jpg",
      "/assets/img/the-dinner-party-4-1500w.jpg",
      "/assets/img/the-dinner-party-5-1500w.jpg"
    ]},
    /* Two colourways, two boxes, two sets of photographs: rose mint and
       chamomile do not share a dishcloth, a tea tin or a backdrop. The gallery
       follows whichever is picked, and the top level images are the rose set
       because rose is what the card and the grid show. */
    {name:"Host's Delight", price:105, img: "/assets/img/0B0_5453-750w.jpg", images:[
      "/assets/img/0B0_5453-750w.jpg",
      "/assets/img/hosts-delight-rose-1-1500w.jpg",
      "/assets/img/hosts-delight-rose-2-1500w.jpg",
      "/assets/img/hosts-delight-rose-3-1500w.jpg",
      "/assets/img/hosts-delight-rose-4-1500w.jpg",
      "/assets/img/hosts-delight-rose-5-1500w.jpg"
    ], variants:[
      {label:"Rose", img:"/assets/img/0B0_5453-750w.jpg", images:[
        "/assets/img/0B0_5453-750w.jpg",
        "/assets/img/hosts-delight-rose-1-1500w.jpg",
        "/assets/img/hosts-delight-rose-2-1500w.jpg",
        "/assets/img/hosts-delight-rose-3-1500w.jpg",
        "/assets/img/hosts-delight-rose-4-1500w.jpg",
        "/assets/img/hosts-delight-rose-5-1500w.jpg"
      ], tea:"<b>OB x Beautea Studio</b> | Organic rose mint loose-leaf tea"},
      {label:"Green", img:"/assets/img/OB_0299-750w.jpg", images:[
        "/assets/img/OB_0299-750w.jpg",
        "/assets/img/hosts-delight-green-1-1500w.jpg",
        "/assets/img/hosts-delight-green-3-1500w.jpg",
        "/assets/img/hosts-delight-green-4-1500w.jpg",
        "/assets/img/hosts-delight-green-5-1500w.jpg",
        "/assets/img/hosts-delight-green-6-1500w.jpg"
      ], tea:"<b>OB x Beautea Studio</b> | Organic chamomile loose-leaf tea"}
    ]},
    {name:"The Nightcap", note:"Contains almond cookies (tree nuts).", price:120, img: "/assets/img/0B0_5067-750w.jpg", images:[
      "/assets/img/0B0_5067-750w.jpg",
      "/assets/img/the-nightcap-1-1500w.jpg",
      "/assets/img/the-nightcap-2-1500w.jpg",
      "/assets/img/the-nightcap-3-1500w.jpg",
      "/assets/img/the-nightcap-4-1500w.jpg",
      "/assets/img/the-nightcap-5-1500w.jpg"
    ]},
    {name:"Lemonade", price:120, img: "/assets/img/0B0_5827-750w.jpg", images:[
      "/assets/img/0B0_5827-750w.jpg",
      "/assets/img/lemonade-1-1500w.jpg",
      "/assets/img/lemonade-2-1500w.jpg",
      "/assets/img/lemonade-3-1500w.jpg",
      "/assets/img/lemonade-4-1500w.jpg",
      "/assets/img/lemonade-5-1500w.jpg"
    ]},
    {name:"Bright Side", price:105, img: "/assets/img/0B0_5699-750w.jpg", images:[
      "/assets/img/0B0_5699-750w.jpg",
      "/assets/img/bright-side-1-1500w.jpg",
      "/assets/img/bright-side-2-1500w.jpg",
      "/assets/img/bright-side-3-1500w.jpg",
      "/assets/img/bright-side-4-1500w.jpg",
      "/assets/img/bright-side-5-1500w.jpg"
    ]},
    {name:"Cheers", price:145, img: "/assets/img/0B0_4910-750w.jpg", images:[
      "/assets/img/0B0_4910-750w.jpg",
      "/assets/img/cheers-1-1500w.jpg",
      "/assets/img/cheers-2-1500w.jpg",
      "/assets/img/cheers-3-1500w.jpg",
      "/assets/img/cheers-4-1500w.jpg",
      "/assets/img/cheers-5-1500w.jpg"
    ]},
    {name:"Everyday Luxe", price:150, img: "/assets/img/0B0_5137-750w.jpg", images:[
      "/assets/img/0B0_5137-750w.jpg",
      "/assets/img/everyday-luxe-1-1500w.jpg",
      "/assets/img/everyday-luxe-2-1500w.jpg",
      "/assets/img/everyday-luxe-3-1500w.jpg",
      "/assets/img/everyday-luxe-4-1500w.jpg",
      "/assets/img/everyday-luxe-5-1500w.jpg"
    ]},
    {name:"Welcome Home", price:125, img: "/assets/img/0B0_5183-750w.jpg", images:[
      "/assets/img/0B0_5183-750w.jpg",
      "/assets/img/welcome-home-1-1500w.jpg",
      "/assets/img/welcome-home-2-1500w.jpg",
      "/assets/img/welcome-home-3-1500w.jpg",
      "/assets/img/welcome-home-4-1500w.jpg",
      "/assets/img/welcome-home-5-1500w.jpg"
    ]},
    {name:"The New Keys", price:170, img: "/assets/img/0B0_4712-750w.jpg", images:[
      "/assets/img/0B0_4712-750w.jpg",
      "/assets/img/the-new-keys-1-1500w.jpg",
      "/assets/img/the-new-keys-2-1500w.jpg",
      "/assets/img/the-new-keys-3-1500w.jpg",
      "/assets/img/the-new-keys-4-1500w.jpg",
      "/assets/img/the-new-keys-5-1500w.jpg"
    ]},
    {name:"The Valet", price:150, img: "/assets/img/_MG_1812-750w.jpg", images:[
      "/assets/img/_MG_1812-750w.jpg",
      "/assets/img/the-valet-2-1500w.jpg",
      "/assets/img/the-valet-3-1500w.jpg",
      "/assets/img/the-valet-4-1500w.jpg",
      "/assets/img/the-valet-5-1500w.jpg",
      "/assets/img/the-valet-6-1500w.jpg"
    ]},
    {name:"Goodnight", price:130, img: "/assets/img/ob_1471-750w.jpg"},
    {name:"Uncorked", price:120, img: "/assets/img/0B0_2489-750w.jpg", images:[
      "/assets/img/0B0_2489-750w.jpg",
      "/assets/img/uncorked-2-1500w.jpg",
      "/assets/img/uncorked-3-1500w.jpg",
      "/assets/img/uncorked-4-1500w.jpg",
      "/assets/img/uncorked-5-1500w.jpg",
      "/assets/img/uncorked-6-1500w.jpg"
    ]},
    {name:"The Wind Down", price:150, img: "/assets/img/_MG_1792-750w.jpg", images:[
      "/assets/img/_MG_1792-750w.jpg",
      "/assets/img/the-wind-down-2-1500w.jpg",
      "/assets/img/the-wind-down-3-1500w.jpg",
      "/assets/img/the-wind-down-4-1500w.jpg",
      "/assets/img/the-wind-down-5-1500w.jpg",
      "/assets/img/the-wind-down-6-1500w.jpg"
    ]},
    {name:"Mini Spa Day", note:"Contains essential oils and a clay mask. Not suitable as a gift for someone who is pregnant or nursing; tell us and we will swap the bath products for something safe.", price:115, img: "/assets/img/IMG_9325-750w.jpg", images:[
      "/assets/img/IMG_9325-750w.jpg",
      "/assets/img/mini-spa-day-1-1500w.jpg",
      "/assets/img/mini-spa-day-2-1500w.jpg",
      "/assets/img/mini-spa-day-3-1500w.jpg",
      "/assets/img/mini-spa-day-4-1500w.jpg"
    ]},
    {name:"First Night In", price:110, img: "/assets/img/ob_6944-750w.jpg", images:[
      "/assets/img/ob_6944-750w.jpg",
      "/assets/img/first-night-in-1-1500w.jpg",
      "/assets/img/first-night-in-2-1500w.jpg",
      "/assets/img/first-night-in-3-1500w.jpg",
      "/assets/img/first-night-in-4-1500w.jpg",
      "/assets/img/first-night-in-5-1500w.jpg"
    ]},
    {name:"Afternoon Tea", note:"Contains almond cookies (tree nuts).", price:128, img: "/assets/img/IMG_9730-750w.jpg", images:[
      "/assets/img/IMG_9730-750w.jpg",
      "/assets/img/afternoon-tea-1-1500w.jpg",
      "/assets/img/afternoon-tea-2-1500w.jpg",
      "/assets/img/afternoon-tea-3-1500w.jpg",
      "/assets/img/afternoon-tea-4-1500w.jpg"
    ]}
  ];

  var currentProduct = null;
  var currentVariant = null;

  /* The colourway is part of what someone bought, so it travels with the
     order to PayPal and to the CRM, not just the picture on screen. */
  function orderName() {
    if (!currentProduct) return '';
    return currentProduct.name + (currentVariant ? ' \u00b7 ' + currentVariant.label : '');
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
        alt: alt ? label + ', ' + alt : (i === 0 ? label + ' gift box' : label + ' gift box, another view')
      };
    }).filter(function(img) { return img.src; });
  }

  /* A colourway carries its own photographs where it has them; otherwise the
     product's own set stands in. */
  function galleryFor(product, variant) {
    var label = product.name + (variant ? ' \u00b7 ' + variant.label : '');
    if (variant && variant.images) return normaliseImages(variant.images, label);
    if (variant && variant.img) return normaliseImages([variant.img], label);
    if (product.images) return normaliseImages(product.images, label);
    return normaliseImages([product.img], label);
  }

  /* The gallery the modal is currently showing, and which of it is on
     screen. The lightbox opens on that same image rather than back at the
     first one. */
  var currentGallery = [];
  var currentIndex = 0;

  /* ─── One gallery painter, two surfaces ───
     The modal on /shop and the twenty one product pages show the same
     photographs and must agree about which ones belong to the colourway on
     screen. Both call this; onShow reports the index back so each surface can
     keep its own lightbox position.

     The strip is rebuilt from the images every time rather than toggled,
     because a colourway change replaces the photographs, not just the one on
     top: the product page used to swap the main shot and leave the strip
     underneath showing the other colour's box. */
  function paintGallery(main, strip, cls, images, onShow) {
    if (!main || !images.length) return function() {};

    var show = function(i) {
      main.src = images[i].src;
      main.alt = images[i].alt;
      if (strip) {
        strip.querySelectorAll('.' + cls).forEach(function(t, j) {
          t.classList.toggle('active', j === i);
          t.setAttribute('aria-current', j === i ? 'true' : 'false');
        });
      }
      if (onShow) onShow(i);
    };

    if (strip) {
      if (images.length > 1) {
        strip.innerHTML = images.map(function(img, i) {
          return '<button type="button" class="' + cls + (i === 0 ? ' active' : '') +
                 '" data-img="' + i + '" aria-label="Show photograph ' + (i + 1) + ' of ' +
                 images.length + ' of ' + escapeHtml(img.alt) + '">' +
                 '<img src="' + escapeHtml(img.src) + '" alt="" loading="lazy"></button>';
        }).join('');
        strip.hidden = false;
        strip.querySelectorAll('.' + cls).forEach(function(btn) {
          btn.addEventListener('click', function() { show(parseInt(this.dataset.img, 10)); });
        });
      } else {
        strip.hidden = true;
        strip.innerHTML = '';
      }
    }
    show(0);
    return show;
  }

  function renderGallery(product) {
    var images = galleryFor(product, currentVariant);
    if (!images.length) return;
    currentGallery = images;
    paintGallery(
      document.getElementById('modalImg'),
      document.getElementById('modalThumbs'),
      'modal-thumb',
      images,
      function(i) { currentIndex = i; }
    );
  }

  /* ─── The handwritten card ───
     Every box ships with a 5x7 card, handwritten, and the buyer picks which
     one. The contents list has promised "a complimentary handwritten card of
     your choice" all along without ever offering the choice, so the choice
     was being made for them somewhere off the website.

     The card is chosen per box, not per order: someone sending three boxes to
     three people wants three different cards. It travels with the cart line
     the same way a colourway does, through to PayPal and into the CRM order,
     so whoever packs the box can read what to write without asking.

     This is the list Occasions Box actually has printed. Adding one here puts
     it on all twenty one product pages and in the modal. */
  var CARD_MESSAGES = [
    "Thank You", "Welcome Baby", "Welcome Home", "Thinking of You", "XO",
    "Happy Mother's Day", "Happy Father's Day", "I Love You", "Congrats",
    "Happy Holidays", "Mr & Mrs", "You're Extraordinary", "Happy Home",
    "Happy Birthday", "Merry Everything", "Grateful For You", "Feliz Navidad",
    "Happy Graduation", "Cheers", "Get Well Soon", "Just Say Yes"
  ];

  /* Not every gift wants a printed sentiment on the front. The blank card
     carries only the Occasions Box mark on the back, and whatever the buyer
     writes goes inside it. */
  var BLANK_CARD = 'Blank card, our logo on the back';

  /* The message the buyer wants written inside, in their words. Long enough
     for a real note, short enough to fit a 5x7 card in handwriting. */
  var MAX_MESSAGE = 240;

  function isValidCard(value) {
    return value === BLANK_CARD || CARD_MESSAGES.indexOf(value) !== -1;
  }

  function cleanMessage(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE);
  }

  /* Reads whichever card picker is on this page. Returns empty strings when
     there is none, which the cart then asks for before checkout. */
  function readCardPicker(selectId, messageId) {
    var sel = document.getElementById(selectId);
    var msg = document.getElementById(messageId);
    return {
      card: sel && isValidCard(sel.value) ? sel.value : '',
      message: msg ? cleanMessage(msg.value) : ''
    };
  }

  function cardOptionsHtml(selected) {
    var opts = CARD_MESSAGES.concat([BLANK_CARD]);
    return '<option value="">Choose your card</option>' +
      opts.map(function(m) {
        return '<option value="' + escapeHtml(m) + '"' +
               (m === selected ? ' selected' : '') + '>' + escapeHtml(m) + '</option>';
      }).join('');
  }

  /* ─── Sharing ───
     Someone who has just found the right gift for a friend is one tap away
     from telling three more people, which is the cheapest reach this shop
     has. The old site put these six under the Add To Cart button on every
     box and the rebuild dropped them.

     One list, read by the product pages at build time and by the modal at
     run time, so the two can never offer different networks. {url}, {title}
     and {image} are filled in per box; every value is URI-encoded first.
     The glyphs are single paths on a 24x24 grid. */
  var SHARE_TARGETS = [
    { name: 'Facebook',
      href: 'https://www.facebook.com/sharer/sharer.php?u={url}',
      icon: 'M14 13.5h2.5l1-4H14v-2c0-1.03 0-2 2-2h1.5V2.14c-.33-.04-1.56-.14-2.86-.14C11.93 2 10 3.66 10 6.7v2.8H7v4h3V22h4v-8.5z' },
    { name: 'Twitter',
      href: 'https://twitter.com/intent/tweet?url={url}&text={title}',
      icon: 'M22 5.8a8.5 8.5 0 0 1-2.36.64 4.13 4.13 0 0 0 1.81-2.27 8.21 8.21 0 0 1-2.61 1 4.1 4.1 0 0 0-7 3.74 11.64 11.64 0 0 1-8.45-4.29 4.16 4.16 0 0 0-.55 2.07 4.09 4.09 0 0 0 1.82 3.41 4.05 4.05 0 0 1-1.86-.51v.05a4.1 4.1 0 0 0 3.3 4.03 4.1 4.1 0 0 1-1.86.07 4.11 4.11 0 0 0 3.83 2.84A8.22 8.22 0 0 1 2 18.28a11.57 11.57 0 0 0 6.29 1.85A11.59 11.59 0 0 0 20 8.45c0-.17 0-.35-.01-.53A8.43 8.43 0 0 0 22 5.8z' },
    { name: 'LinkedIn',
      href: 'https://www.linkedin.com/sharing/share-offsite/?url={url}',
      icon: 'M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3V9zm7 0h3.8v1.7h.05c.53-1 1.83-2.05 3.75-2.05C21.6 8.65 22 11.1 22 14.3V21h-4v-6c0-1.43-.03-3.27-2-3.27-2 0-2.3 1.56-2.3 3.17V21h-4V9z' },
    { name: 'Reddit',
      href: 'https://www.reddit.com/submit?url={url}&title={title}',
      icon: 'M22 12.14a2.14 2.14 0 0 0-3.62-1.54 10.5 10.5 0 0 0-5.35-1.7l.91-4.29 2.98.63a1.72 1.72 0 1 0 .2-1.42l-3.6-.76a.7.7 0 0 0-.83.54l-1.1 5.2a10.5 10.5 0 0 0-5.4 1.7A2.14 2.14 0 1 0 3.6 14.2a4.2 4.2 0 0 0-.05.65c0 3.3 3.78 5.98 8.45 5.98s8.45-2.68 8.45-5.98a4.2 4.2 0 0 0-.05-.64A2.14 2.14 0 0 0 22 12.14zM7.5 13.6a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm8.3 4.2c-1.03.92-3 .99-3.8.99s-2.77-.07-3.8-.99a.4.4 0 0 1 .53-.6c.65.58 2.04.79 3.27.79s2.62-.21 3.27-.79a.4.4 0 0 1 .53.6zm-.3-2.7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z' },
    { name: 'Tumblr',
      href: 'https://www.tumblr.com/widgets/share/tool?canonicalUrl={url}&caption={title}',
      icon: 'M14.2 21c-3.2 0-5.6-1.64-5.6-5.57V10.1H6V7.5c2.86-.74 4.06-3.2 4.2-5.5h2.53v4.99h3.5v3.1h-3.5v4.7c0 1.48.75 2 1.94 2H16.4V21h-2.2z' },
    { name: 'Pinterest',
      href: 'https://pinterest.com/pin/create/button/?url={url}&media={image}&description={title}',
      icon: 'M12 2a10 10 0 0 0-3.65 19.31c-.09-.78-.17-1.98.03-2.83.18-.78 1.18-4.98 1.18-4.98s-.3-.6-.3-1.5c0-1.4.82-2.45 1.83-2.45.86 0 1.28.65 1.28 1.42 0 .87-.55 2.17-.84 3.37-.24 1.01.5 1.84 1.5 1.84 1.8 0 3.19-1.9 3.19-4.65 0-2.43-1.75-4.13-4.24-4.13-2.89 0-4.59 2.17-4.59 4.41 0 .87.34 1.81.76 2.32.08.1.1.19.07.29l-.28 1.15c-.05.18-.15.22-.34.13-1.27-.59-2.06-2.44-2.06-3.93 0-3.2 2.32-6.13 6.7-6.13 3.52 0 6.25 2.5 6.25 5.85 0 3.5-2.2 6.31-5.26 6.31-1.03 0-2-.53-2.32-1.17l-.63 2.4c-.23.88-.85 1.98-1.26 2.65A10 10 0 1 0 12 2z' }
  ];

  function shareRowHtml(url, title, image) {
    return SHARE_TARGETS.map(function(t) {
      var href = t.href
        .replace('{url}', encodeURIComponent(url))
        .replace('{title}', encodeURIComponent(title))
        .replace('{image}', encodeURIComponent(image || ''));
      return '<a class="share-link" href="' + href + '" target="_blank" rel="noopener noreferrer"' +
             ' aria-label="Share ' + escapeHtml(title) + ' on ' + t.name + '" title="Share on ' + t.name + '">' +
             '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + t.icon + '"/></svg></a>';
    }).join('');
  }

  /* The modal has no address of its own, so it shares the box's product page
     rather than whatever page the modal happens to be open on top of. */
  function renderShare(product) {
    var row = document.getElementById('modalShare');
    if (!row) return;
    var origin = window.location.origin;
    var url = origin + '/shop/' + slugifyName(product.name);
    var image = product.img ? origin + product.img : '';
    row.innerHTML = shareRowHtml(url, product.name + ' from Occasions Box', image);
    row.hidden = false;
  }

  /* ─── More boxes to consider ───
     Someone who opened a box and is not sure about it should not have to shut
     the modal to see a second one. The four shown are the same four that the box’s
     own product page shows, picked by the same rule: most occasion tags in
     common first, then catalogue order, topped up with the next boxes along so
     there are always four. The tags are read off the shop cards already in the
     page rather than repeated here, which is why the two can never disagree.

     Each one reopens the modal in place instead of navigating away, so the
     browser back button still means "leave the shop". */
  var occasionTags = null;

  function loadOccasionTags() {
    if (occasionTags) return occasionTags;
    occasionTags = {};
    document.querySelectorAll(".shop-card[data-occasion]").forEach(function(card) {
      var link = card.querySelector(".shop-card-link");
      var href = link && link.getAttribute("href");
      var slug = href && href.split("/").filter(Boolean).pop();
      if (!slug) return;
      occasionTags[slug] = (card.getAttribute("data-occasion") || "").split(/\s+/)
        .filter(Boolean);
    });
    return occasionTags;
  }

  function relatedProducts(product) {
    var tags = loadOccasionTags();
    var mine = tags[slugifyName(product.name)] || [];
    var shared = function(q) {
      var theirs = tags[slugifyName(q.name)] || [];
      return theirs.filter(function(t) { return mine.indexOf(t) !== -1; }).length;
    };
    var i = allProducts.indexOf(product);
    var byOccasion = allProducts
      .filter(function(q) { return q !== product && shared(q) > 0; })
      .sort(function(a, b) {
        return shared(b) - shared(a) ||
               allProducts.indexOf(a) - allProducts.indexOf(b);
      });
    var neighbours = [1, 2, 3, 4].map(function(k) {
      return allProducts[(i + k) % allProducts.length];
    });
    var out = [];
    byOccasion.concat(neighbours).forEach(function(q) {
      if (q && q !== product && out.indexOf(q) === -1) out.push(q);
    });
    return out.slice(0, 4);
  }

  /* Six boxes are called "The Something" and do not want a second article. */
  function theName(name) {
    return /^the\s/i.test(name) ? name : 'The ' + name;
  }

  function renderMore(product) {
    var wrap = document.getElementById("modalMore");
    if (!wrap) return;
    var related = relatedProducts(product);
    if (!related.length) {
      wrap.hidden = true;
      wrap.innerHTML = "";
      return;
    }
    wrap.innerHTML =
      "<h3 class=\"modal-more-title\">More beautiful boxes to consider</h3>" +
      "<div class=\"modal-more-grid\">" +
      related.map(function(r) {
        return "<button type=\"button\" class=\"modal-more-card\" data-more=\"" +
               escapeHtml(r.name) + "\">" +
               "<img src=\"" + r.img + "\" loading=\"lazy\" alt=\"" +
               escapeHtml(theName(r.name)) + " gift box\">" +
               "<span class=\"modal-more-name\">" + escapeHtml(r.name) + "</span>" +
               "<span class=\"modal-more-price\">$" + r.price.toFixed(2) + "</span>" +
               "</button>";
      }).join("") +
      "</div>" +
      "<p class=\"modal-more-all\"><a href=\"/shop\">See all " + allProducts.length +
      " boxes</a></p>";
    wrap.hidden = false;
    wrap.querySelectorAll(".modal-more-card").forEach(function(btn) {
      btn.addEventListener("click", function() {
        openModal(btn.getAttribute("data-more"));
        var modal = document.querySelector("#productModal .modal");
        if (modal) modal.scrollTop = 0;
      });
    });
  }

  /* Matches the slugs tools/build-pages.mjs writes, so the link resolves. */
  function slugifyName(name) {
    /* Character for character the same transform as slugify() in
       tools/build-pages.mjs, which is what actually names the files. An
       ampersand is a separator there, so Peaches & Cream is peaches-cream.
       tools/build-pages.mjs fails the build if the two ever drift. */
    return name.toLowerCase().replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  /* ─── Lightbox ───
     The photograph is the product. At 750px inside a modal you cannot see the
     weave on the towel or read a label, which is most of what someone is
     looking for before they spend $150, so the main image opens full size.

     The markup is built once, on first use, rather than sitting in every one
     of the twenty-one product pages and the modal partial. Escape closes it,
     the arrow keys walk a multi-photograph box, and focus goes back to
     whatever opened it. */
  var lightbox = null;

  function buildLightbox() {
    if (lightbox) return lightbox;

    var root = document.createElement('div');
    root.className = 'lightbox';
    root.id = 'lightbox';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Photograph');
    root.hidden = true;
    root.innerHTML =
      '<button type="button" class="lightbox-close" aria-label="Close photograph">&times;</button>' +
      '<button type="button" class="lightbox-nav lightbox-prev" aria-label="Previous photograph">&lsaquo;</button>' +
      '<figure class="lightbox-figure">' +
        '<img class="lightbox-img" alt="">' +
        '<figcaption class="lightbox-caption"></figcaption>' +
      '</figure>' +
      '<button type="button" class="lightbox-nav lightbox-next" aria-label="Next photograph">&rsaquo;</button>';
    document.body.appendChild(root);

    lightbox = {
      root: root,
      img: root.querySelector('.lightbox-img'),
      caption: root.querySelector('.lightbox-caption'),
      prev: root.querySelector('.lightbox-prev'),
      next: root.querySelector('.lightbox-next'),
      close: root.querySelector('.lightbox-close'),
      images: [],
      at: 0,
      opener: null
    };

    lightbox.close.addEventListener('click', closeLightbox);
    lightbox.prev.addEventListener('click', function() { stepLightbox(-1); });
    lightbox.next.addEventListener('click', function() { stepLightbox(1); });

    /* The backdrop closes; the photograph and the controls do not. */
    root.addEventListener('click', function(e) {
      if (e.target === root || e.target.classList.contains('lightbox-figure')) closeLightbox();
    });

    return lightbox;
  }

  function paintLightbox() {
    var lb = lightbox;
    var img = lb.images[lb.at];
    if (!img) return;
    lb.img.src = img.src;
    lb.img.alt = img.alt;
    lb.caption.textContent = lb.images.length > 1
      ? img.alt + ' (' + (lb.at + 1) + ' of ' + lb.images.length + ')'
      : img.alt;
    var many = lb.images.length > 1;
    lb.prev.hidden = !many;
    lb.next.hidden = !many;
  }

  function stepLightbox(by) {
    if (!lightbox || lightbox.images.length < 2) return;
    var n = lightbox.images.length;
    lightbox.at = (lightbox.at + by + n) % n;
    paintLightbox();
  }

  function openLightbox(images, at, opener) {
    if (!images || !images.length) return;
    var lb = buildLightbox();
    lb.images = images;
    lb.at = Math.min(Math.max(at || 0, 0), images.length - 1);
    lb.opener = opener || null;
    paintLightbox();
    lb.root.hidden = false;
    /* The class lands a frame later so the fade actually has somewhere to
       fade from. */
    requestAnimationFrame(function() { lb.root.classList.add('active'); });
    document.body.classList.add('lightbox-open');
    lb.close.focus();
  }

  function closeLightbox() {
    if (!lightbox || lightbox.root.hidden) return;
    lightbox.root.classList.remove('active');
    lightbox.root.hidden = true;
    document.body.classList.remove('lightbox-open');
    /* The product modal may still be open behind it, and it owns the scroll
       lock; only give the page back if nothing else is holding it. */
    var modal = document.getElementById('productModal');
    if (!modal || !modal.classList.contains('active')) document.body.style.overflow = '';
    if (lightbox.opener && lightbox.opener.focus) lightbox.opener.focus();
    lightbox.opener = null;
  }
  window.closeLightbox = closeLightbox;

  document.addEventListener('keydown', function(e) {
    if (!lightbox || lightbox.root.hidden) return;
    if (e.key === 'Escape') { e.stopPropagation(); closeLightbox(); }
    else if (e.key === 'ArrowLeft') stepLightbox(-1);
    else if (e.key === 'ArrowRight') stepLightbox(1);
  }, true);

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

    var modalCard = document.getElementById('modalCard');
    if (modalCard) modalCard.innerHTML = cardOptionsHtml('');
    var modalCardMsg = document.getElementById('modalCardMsg');
    if (modalCardMsg) modalCardMsg.value = '';

    renderGallery(product);
    renderContents(product);
    renderShare(product);
    renderMore(product);
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

    /* The story and the list are not alternatives. The prose says who the box
       is for, the list says what is in it, and a buyer wants both. Only a box
       with neither falls back to the generic sentence already in the markup. */
    var story = PRODUCT_STORIES[product.name];
    if (desc) {
      if (story) {
        desc.textContent = story;
        desc.hidden = false;
      } else {
        desc.hidden = !!(contents && contents.length);
      }
    }

    if (list) {
      if (contents && contents.length) {
        list.innerHTML = '<div class="modal-contents-title">Box includes</div><ul>' +
          contents.map(function(item) { return '<li>' + item + '</li>'; }).join('') + '</ul>';
        list.hidden = false;
      } else {
        list.hidden = true;
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
  var stripeMounted = false;

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
        /* A card we no longer print is dropped rather than carried into an
           order nobody can fulfil. */
        var card = typeof line.card === 'string' && isValidCard(line.card) ? line.card : '';
        return {
          name: line.name,
          variant: typeof line.variant === 'string' ? line.variant : '',
          card: card,
          message: cleanMessage(line.message),
          qty: Math.min(Math.round(line.qty), MAX_QTY)
        };
      });
    } catch (e) {
      // Private browsing, blocked storage, corrupted JSON: start empty.
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
    return line.name + (line.variant ? ' \u00b7 ' + line.variant : '');
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

  /* ─── Processing and handling ───
     Every card and wallet takes a cut, and at PayPal's US rate that is 3.49%
     plus 49 cents on a checkout sale. This recovers most of it.

     It is charged on every order, whatever the buyer pays with, and that is
     deliberate rather than incidental. PayPal's own User Agreement says a
     seller "will not impose a surcharge or any other fee for accepting PayPal
     as a payment method", and in the same breath allows a handling fee "as
     long as the handling fee does not operate as a surcharge and is not
     higher than the handling fee you charge for non-PayPal transactions".
     A fee that appears only when someone reaches for PayPal is the first
     thing; a flat fee on the sale is the second. Charging it uniformly also
     keeps us clear of the card network rule against surcharging debit cards,
     and of the states that ban surcharging outright, neither of which reaches
     a fee that is not conditioned on how the buyer pays.

     One rate, one label, one place to change either. */
  var PROCESSING_RATE = 0.03;
  var PROCESSING_LABEL = 'Processing & Handling';

  /* Rounded once on the whole order rather than per line, so three boxes are
     charged what one order costs instead of three separate roundings. */
  function processingCents(baseCents) {
    return Math.round(baseCents * PROCESSING_RATE);
  }

  function money(cents) {
    return '$' + (cents / 100).toFixed(2);
  }

  /* Sarah cannot pack a box without knowing which card goes in it, and
     chasing the buyer by email after the fact loses a day on a gift that is
     usually already late. So the card is required, and checkout waits. */
  function linesMissingCard(resolved) {
    return resolved.filter(function(r) { return !r.line.card; });
  }

  function cartUnits(resolved) {
    return resolved.reduce(function(n, r) { return n + r.line.qty; }, 0);
  }

  function addToCart(product, variant, qty, card, message) {
    var variantLabel = variant ? variant.label : '';
    var cardLabel = isValidCard(card) ? card : '';
    var note = cleanMessage(message);
    /* Same box, same colourway, same card and the same words is one line. Any
       of those different and it is a different gift going to a different
       person, so it gets its own line. */
    var existing = cart.find(function(l) {
      return l.name === product.name && (l.variant || '') === variantLabel &&
             (l.card || '') === cardLabel && (l.message || '') === note;
    });
    if (existing) {
      existing.qty = Math.min(existing.qty + qty, MAX_QTY);
    } else {
      if (cart.length >= MAX_LINES) {
        showToast('That is as many different boxes as the cart holds. Email Collaborate@occasionsbox.com and we will quote the whole order.', 'error');
        return false;
      }
      cart.push({ name: product.name, variant: variantLabel, card: cardLabel,
                  message: note, qty: Math.min(qty, MAX_QTY) });
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
          '<div class="cart-item-card' + (r.line.card ? '' : ' needs-card') + '">' +
            '<label for="cartCard' + i + '">Card</label>' +
            '<select id="cartCard' + i + '" class="cart-card-select" data-act="card">' +
              cardOptionsHtml(r.line.card || '') +
            '</select>' +
            '<label for="cartMsg' + i + '">Your message</label>' +
            '<textarea id="cartMsg' + i + '" class="cart-msg" data-act="msg" rows="2" ' +
              'maxlength="' + MAX_MESSAGE + '" placeholder="We will write this inside, by hand. Leave it blank for just the card.">' +
              escapeHtml(r.line.message || '') + '</textarea>' +
          '</div>' +
        '</div>' +
        '<div class="cart-item-total">' + money(Math.round(r.price * 100) * r.line.qty) + '</div>' +
      '</li>';
    }).join('');

    var empty = document.getElementById('cartEmpty');
    var foot = document.getElementById('cartFoot');
    if (empty) empty.hidden = resolved.length > 0;
    if (foot) foot.hidden = resolved.length === 0;

    var subCents = subtotalCents(resolved);
    var feeCents = processingCents(subCents);
    var subtotal = document.getElementById('cartSubtotal');
    if (subtotal) subtotal.textContent = money(subCents);
    var feeEl = document.getElementById('cartFee');
    if (feeEl) feeEl.textContent = money(feeCents);
    var dueEl = document.getElementById('cartDue');
    if (dueEl) dueEl.textContent = money(subCents + feeCents);

    var missing = linesMissingCard(resolved);
    var warn = document.getElementById('cartCardWarning');
    if (warn) {
      warn.textContent = missing.length === 1
        ? 'Choose a card for ' + missing[0].label + ' before checking out.'
        : 'Choose a card for each of your ' + missing.length + ' boxes before checking out.';
      warn.hidden = missing.length === 0;
    }
    var pay = document.getElementById('paypal-button-container');
    if (pay) pay.classList.toggle('is-blocked', missing.length > 0);
    var stripeBtn = document.getElementById('stripeCheckout');
    if (stripeBtn) stripeBtn.classList.toggle('is-blocked', missing.length > 0);
  }

  function openCart() {
    var overlay = document.getElementById('cartOverlay');
    if (!overlay) return;
    renderCart();
    overlay.hidden = false;
    requestAnimationFrame(function() { overlay.classList.add('open'); });
    document.body.style.overflow = 'hidden';
    mountCheckout();
    mountStripe();
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
     matches the sum, so the payer's receipt lists what they actually bought
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
      /* Dimming the container is the visible half. This is the half that
         holds when someone deletes the class in the inspector. */
      onClick: function(data, actions) {
        var missing = linesMissingCard(resolveCart());
        if (!missing.length) return actions.resolve();
        showToast('Choose a card for every box first. Each one is handwritten.', 'error');
        var first = document.querySelector('.cart-item-card.needs-card .cart-card-select');
        if (first) first.focus();
        return actions.reject();
      },
      createOrder: function(data, actions) {
        var resolved = resolveCart();
        var itemCents = subtotalCents(resolved);
        var feeCents = processingCents(itemCents);
        var items = (itemCents / 100).toFixed(2);
        var handling = (feeCents / 100).toFixed(2);
        var total = ((itemCents + feeCents) / 100).toFixed(2);
        var units = cartUnits(resolved);
        var description = resolved.length === 1
          ? resolved[0].label + ' Gift Box'
          : 'Occasions Box: ' + units + ' gift boxes';
        return actions.order.create({
          purchase_units: [{
            description: description.slice(0, 127),
            amount: {
              value: total,
              currency_code: 'USD',
              breakdown: {
                item_total: { value: items, currency_code: 'USD' },
                handling: { value: handling, currency_code: 'USD' }
              }
            },
            items: resolved.map(function(r) {
              var note = [r.line.card, r.line.message && '"' + r.line.message + '"']
                .filter(Boolean).join(' - ');
              return {
                name: r.label.slice(0, 127),
                description: note.slice(0, 127),
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
        var fee = processingCents(cents);
        return actions.order.capture().then(function(details) {
          closeCart();
          // Guest checkout / some funding sources return a payer without a name object.
          var payer = (details && details.payer) || {};
          var given = (payer.name && payer.name.given_name) || '';
          showToast('Order confirmed! Thank you' + (given ? ', ' + given : '') + '.', 'success');
          cart = [];
          saveCart();
          renderCart();
          var unit = (details && details.purchase_units && details.purchase_units[0]) || {};
          recordOrder(data.orderID, payer, resolved, cents, fee, unit.shipping || null);
        });
      },
      onError: function(err) {
        showToast('Payment error. Please try again.', 'error');
      }
    }).render('#paypal-button-container');
  }

  /* ─── Stripe Checkout ───
     The card button asks the CRM for a hosted Checkout Session and sends the
     buyer there. Nothing about the payment is decided in this browser: the
     CRM prices the cart from the catalogue, Stripe takes the card, and
     Stripe's webhook tells the CRM when it is paid. The buyer comes back to
     /shop with ?checkout=success or ?checkout=cancelled. */
  function mountStripe() {
    var btn = document.getElementById('stripeCheckout');
    if (!btn || stripeMounted) return;
    stripeMounted = true;
    var label = btn.textContent;
    btn.addEventListener('click', function() {
      var resolved = resolveCart();
      if (!resolved.length) return;
      var missing = linesMissingCard(resolved);
      if (missing.length) {
        showToast('Choose a card for every box first. Each one is handwritten.', 'error');
        var first = document.querySelector('.cart-item-card.needs-card .cart-card-select');
        if (first) first.focus();
        return;
      }
      if (!CRM_CONFIG.enabled || !CRM_CONFIG.stripeCheckoutUrl) return;
      btn.disabled = true;
      btn.textContent = 'Taking you to checkout\u2026';
      fetch(CRM_CONFIG.stripeCheckoutUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: resolved.map(function(r) {
            return {
              name: r.line.name,
              variant: r.line.variant || '',
              card: r.line.card || '',
              message: r.line.message || '',
              unitAmount: r.price,
              quantity: r.line.qty
            };
          })
        })
      })
      .then(function(res) {
        return res.json().catch(function() { return {}; }).then(function(data) {
          if (!res.ok || !data || !data.url) {
            throw new Error((data && data.error) || 'Card checkout is unavailable right now.');
          }
          window.location.assign(data.url);
        });
      })
      .catch(function(err) {
        btn.disabled = false;
        btn.textContent = label;
        showToast((err && err.message) || 'Card checkout is unavailable right now. PayPal still works.', 'error');
      });
    });
  }

  /* Back from Stripe. Success empties the cart, because Stripe has the money
     and the CRM has the order; cancel leaves it exactly as it was. The
     parameters are dropped from the address bar so a refresh does not
     repeat the message. */
  function handleCheckoutReturn() {
    var params;
    try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
    var state = params.get('checkout');
    if (!state) return;
    if (state === 'success') {
      cart = [];
      saveCart();
      renderCart();
      showToast('Order confirmed! Thank you. Your receipt is on its way from Stripe.', 'success');
    } else if (state === 'cancelled') {
      showToast('Checkout cancelled. Your cart is still here.', 'error');
    }
    params.delete('checkout');
    params.delete('session_id');
    var rest = params.toString();
    try {
      window.history.replaceState(null, '', window.location.pathname + (rest ? '?' + rest : '') + window.location.hash);
    } catch (e) { /* older browsers keep the parameters; nothing breaks */ }
  }

  /* Payment has already succeeded by the time this runs, so a CRM failure is
     reported to us and softened for the buyer, never treated as a failed sale. */
  function recordOrder(paypalOrderId, payer, resolved, cents, feeCents, shipping) {
    if (!CRM_CONFIG.enabled || !CRM_CONFIG.apiUrl) return;
    var payerName = [payer.name && payer.name.given_name, payer.name && payer.name.surname]
      .filter(Boolean).join(' ');
    var payerPhone = (payer.phone && payer.phone.phone_number && payer.phone.phone_number.national_number) || '';
    fetch(CRM_CONFIG.apiUrl + '/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: resolved.map(function(r) {
          return {
            name: r.line.name,
            variant: r.line.variant || '',
            card: r.line.card || '',
            message: r.line.message || '',
            unitAmount: r.price,
            quantity: r.line.qty
          };
        }),
        amount: (cents + feeCents) / 100,
        subtotal: cents / 100,
        processingFee: feeCents / 100,
        processingLabel: PROCESSING_LABEL,
        currency: 'USD',
        paypalOrderId: paypalOrderId,
        payerEmail: payer.email_address || '',
        payerName: payerName,
        payerPhone: payerPhone,
        // Where PayPal says the boxes are going, so the packing slip in the
        // CRM carries the address without anyone retyping it.
        shipping: shipping ? {
          name: (shipping.name && shipping.name.full_name) || '',
          address: shipping.address || null
        } : null,
        status: 'paid'
      })
    })
    .then(function(res) {
      if (!res.ok) throw new Error('CRM order ingest failed: HTTP ' + res.status);
    })
    .catch(function(err) {
      console.error('Order recorded by PayPal but not by the CRM:', err);
      showToast('Order received. We\'ll confirm by email', 'success');
    });
  }

  window.closeModal = function() {
    document.getElementById('productModal').classList.remove('active');
    document.body.style.overflow = '';
  };

  /* ─── Opening the photograph ───
     Two places show a product photograph: the modal on /shop, and the twenty
     one product pages. Both hand the same gallery to the same lightbox. */
  var modalMainImg = document.getElementById('modalImg');
  if (modalMainImg) {
    modalMainImg.addEventListener('click', function() {
      openLightbox(currentGallery, currentIndex, modalMainImg);
    });
  }

  var pdRepaint = null;
  var pdArticle = document.querySelector('.pd[data-product]');
  var pdMainImg = document.getElementById('pdImg');
  if (pdArticle && pdMainImg) {
    var pdGalleryProduct = allProducts.find(function(p) { return p.name === pdArticle.dataset.product; });
    var pdStrip = pdArticle.querySelector('.pd-thumbs');
    var pdImages = [{ src: pdMainImg.src, alt: pdMainImg.alt }];
    var pdAt = 0;

    /* Exposed so the colourway buttons below can repaint the strip. */
    pdRepaint = function(variant) {
      if (!pdGalleryProduct) return;
      pdImages = galleryFor(pdGalleryProduct, variant);
      if (!pdImages.length) return;
      paintGallery(pdMainImg, pdStrip, 'pd-thumb', pdImages, function(i) { pdAt = i; });
    };
    pdRepaint((pdGalleryProduct && pdGalleryProduct.variants && pdGalleryProduct.variants[0]) || null);

    pdMainImg.addEventListener('click', function() {
      openLightbox(pdImages, pdAt, pdMainImg);
    });
  }

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
  document.querySelectorAll('.shop-card-btn').forEach(function(el) {
    el.addEventListener('click', function() {
      var name = this.closest('.shop-card').querySelector('.shop-card-name').textContent;
      openModal(name);
    });
  });

  /* ─── Save to Pinterest, and a card that is clickable all over ───
     The button under each card was a third way to do what clicking the
     photograph already did, and it was the tallest piece of white space in
     the grid, so it is gone and the name and price open the box instead.

     The Save button is built here rather than written into all twenty one
     cards, and it reuses the Pinterest entry in SHARE_TARGETS so the pin a
     shopper saves from the grid matches the one they would get from the box's
     own page. */
  var pinTarget = SHARE_TARGETS.filter(function(t) { return t.name === 'Pinterest'; })[0];

  document.querySelectorAll('.shop-card').forEach(function(card) {
    var body = card.querySelector('.shop-card-body');
    var nameEl = card.querySelector('.shop-card-name');
    if (body && nameEl) {
      body.addEventListener('click', function() { openModal(nameEl.textContent); });
    }

    var frame = card.querySelector('.shop-card-frame');
    var link = card.querySelector('.shop-card-link');
    var img = card.querySelector('.shop-card-img');
    if (!pinTarget || !frame || !link || !img || !nameEl) return;

    /* .href and .src read back absolute, which is what Pinterest needs. */
    var pin = document.createElement('a');
    pin.className = 'shop-pin';
    pin.href = pinTarget.href
      .replace('{url}', encodeURIComponent(link.href))
      .replace('{image}', encodeURIComponent(img.src))
      .replace('{title}', encodeURIComponent(nameEl.textContent + ' from Occasions Box'));
    pin.target = '_blank';
    pin.rel = 'noopener noreferrer';
    pin.setAttribute('aria-label', 'Save ' + nameEl.textContent + ' to Pinterest');
    pin.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' +
      pinTarget.icon + '"/></svg>Save';
    /* Clicking the card opens the box. Saving it must not. */
    pin.addEventListener('click', function(e) { e.stopPropagation(); });
    frame.appendChild(pin);

    /* ─── Quick view ───
       The whole card already opens the box, but nothing on it said so. A bar
       across the foot of the photograph on hover does, and it is the one
       affordance the View Details button was carrying before the grid gave
       its room back to the photographs. */
    var quick = document.createElement('button');
    quick.type = 'button';
    quick.className = 'shop-quickview';
    quick.textContent = 'Quick view';
    quick.setAttribute('aria-label', 'Quick view of ' + nameEl.textContent);
    quick.addEventListener('click', function(e) {
      e.stopPropagation();
      openModal(nameEl.textContent);
    });
    frame.appendChild(quick);

    /* ─── Paging the photographs on the card ───
       A box with several shots can be flicked through without opening it,
       which is how somebody scanning twenty one boxes decides which one to
       open. One photograph and the arrows never appear. */
    var product = allProducts.find(function(pr) { return pr.name === nameEl.textContent; });
    var shots = product ? galleryFor(product, null) : [];
    if (shots.length > 1) {
      var at = 0;
      var step = function(by, e) {
        e.stopPropagation();
        at = (at + by + shots.length) % shots.length;
        img.src = shots[at].src;
        img.alt = shots[at].alt;
      };
      ['prev', 'next'].forEach(function(dir) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'shop-page shop-page-' + dir;
        b.innerHTML = dir === 'prev' ? '&lsaquo;' : '&rsaquo;';
        b.setAttribute('aria-label', (dir === 'prev' ? 'Previous' : 'Next') +
          ' photograph of ' + nameEl.textContent);
        b.addEventListener('click', function(e) { step(dir === 'prev' ? -1 : 1, e); });
        frame.appendChild(b);
      });
    }
  });

  /* The photograph is a real link to the box's own page, which is what a
     crawler follows and what a middle click, a long press or a shared link
     opens. A plain left click still opens the modal, because browsing twenty
     one boxes is faster without a page load between each one. */
  document.querySelectorAll('.shop-card-link').forEach(function(a) {
    a.addEventListener('click', function(e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      openModal(this.closest('.shop-card').querySelector('.shop-card-name').textContent);
    });
  });

  /* ─── Product page ───
     Every box now has its own address. The page is rendered at build time, so
     a crawler and anyone without JavaScript still see the whole box and its
     contents; this adds only the buying and the colourway switch. */
  var pdRoot = document.querySelector('.pd[data-product]');
  var pdProduct = pdRoot && allProducts.find(function(p) { return p.name === pdRoot.dataset.product; });
  if (pdProduct) {
    currentProduct = pdProduct;
    currentVariant = (pdProduct.variants && pdProduct.variants[0]) || null;

    var pdImg = document.getElementById('pdImg');
    var pdContents = document.getElementById('pdContents');

    pdRoot.querySelectorAll('.pd-variant').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var v = pdProduct.variants[parseInt(btn.dataset.variant, 10)];
        if (!v) return;
        currentVariant = v;
        pdRoot.querySelectorAll('.pd-variant').forEach(function(b) {
          b.classList.toggle('active', b === btn);
        });
        /* The colourway is a different set of photographs, not a different
           first photograph, so the strip is rebuilt with it. */
        if (pdRepaint) pdRepaint(v);
        else if (pdImg && v.img) { pdImg.src = v.img; }
        /* The tea is the one line that differs between the colourways. */
        if (pdContents && v.tea) {
          var items = pdContents.querySelectorAll('li');
          if (items[1]) items[1].innerHTML = v.tea;
        }
      });
    });

    var pdAdd = document.getElementById('pdAdd');
    if (pdAdd) pdAdd.addEventListener('click', function() {
      var qty = parseInt(document.getElementById('pdQty').value, 10);
      if (!qty || qty < 1) qty = 1;
      if (qty > MAX_QTY) qty = MAX_QTY;
      var pick = readCardPicker('pdCard', 'pdCardMsg');
      if (!addToCart(pdProduct, currentVariant, qty, pick.card, pick.message)) return;
      if (document.getElementById('cartOverlay')) {
        openCart();
      } else {
        showToast(orderName() + ' added to your cart.', 'success');
      }
    });
  }

  var modalAdd = document.getElementById('modalAdd');
  if (modalAdd) modalAdd.addEventListener('click', function() {
    if (!currentProduct) return;
    var qty = parseInt(document.getElementById('modalQty').value, 10);
    if (!qty || qty < 1) qty = 1;
    if (qty > MAX_QTY) qty = MAX_QTY;
    var pick = readCardPicker('modalCard', 'modalCardMsg');
    if (!addToCart(currentProduct, currentVariant, qty, pick.card, pick.message)) return;
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
    if (act === 'card' || act === 'msg') return; // handled on change, below
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

  /* Choosing the card in the cart, for anyone who added the box before
     deciding, or who is sending the same box to two people. */
  if (cartItemsEl) cartItemsEl.addEventListener('change', function(e) {
    var field = e.target.closest('.cart-card-select, .cart-msg');
    if (!field) return;
    var row = field.closest('.cart-item');
    if (!row) return;
    var resolved = resolveCart();
    var entry = resolved[parseInt(row.dataset.line, 10)];
    if (!entry) return;
    if (field.classList.contains('cart-msg')) entry.line.message = cleanMessage(field.value);
    else entry.line.card = isValidCard(field.value) ? field.value : '';

    /* Changing a card can make two lines identical. Fold them together rather
       than leaving the same box listed twice with the same card. */
    var merged = [];
    cart.forEach(function(line) {
      var twin = merged.find(function(m) {
        return m.name === line.name && (m.variant || '') === (line.variant || '') &&
               (m.card || '') === (line.card || '');
      });
      if (twin) twin.qty = Math.min(twin.qty + line.qty, MAX_QTY);
      else merged.push(line);
    });
    cart = merged;

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
  handleCheckoutReturn();
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
      showToast('Something went wrong. Email Hello@occasionsbox.com', 'error');
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
      showToast('Something went wrong. Email Hello@occasionsbox.com', 'error');
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
