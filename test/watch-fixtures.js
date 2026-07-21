// KingKit product-page HTML fixtures, condensed from real responses captured
// 2026-07-21. The class names, attribute order and structure inside the
// price-availability-block are verbatim; page chrome, qty options and footer
// copy are cut.
(function (global) {
  'use strict';

  // /product/takom-sale-items-1-16-01013-japanese-navy-battleship-yamato-anchors--special-offer-price
  // Discounted, new condition only (the pre-owned column is an empty div).
  var PAGE_TAKOM_SALE =
    '<!DOCTYPE html><html><head><title>01013 JAPANESE NAVY BATTLESHIP YAMATO ANCHORS - SPECIAL OFFER PRICE</title></head><body>' +
    '<div class="col-xs-12 col-sm-9 col-md-9"><div class="product-page"><div class="row">' +
    '<div class="col-md-6 col-sm-6">' +
    '<h1>TAKOM 1/16 01013 JAPANESE NAVY BATTLESHIP YAMATO ANCHORS - SPECIAL OFFER PRICE</h1>' +
    '<div class="description"></div>' +
    '<div class="price-availability-block clearfix">' +
    '<div class="price" style="width:100%;">' +
    '<div class="col-xs-12 col-sm-6 padleft0 newpriceblock">' +
    '<form action="/basket" method="post">' +
    '<input type="hidden" name="action" value="basketadd">' +
    '<input type="hidden" name="ptype" value="new">' +
    '<input type="hidden" name="product_id" value="99572">' +
    '<div class="priceheight">' +
    '<small style="font-weight:bold"><strike>Buy New <span style="font-size:14px;">£39.99</span></strike></small><br/>' +
    '<p class="saleprice">Now only <span>£19.99</span></p>' +
    '</div>' +
    '<div style="clear:both; height:20px;"></div>' +
    '<select name="quantity" class="form-control"><option value="">Please Select...</option><option value="1" class="qtyNew">1</option></select>' +
    '<p class="instock">3 in stock</p>' +
    '<div class="product-page-cart"><button class="btn btn-success " type="submit"> Add to basket</button></div>' +
    '</form>' +
    '</div>' +
    '<div class="col-xs-12 col-sm-6 mobpadleft0 padright0"></div>' +
    '</div></div></div></div></div></div>' +
    '</body></html>';

  // /product/eduard-aircraft-1-48-8021-hawker-tempest-mkv
  // Discounted, pre-owned only (the new column is an empty div).
  var PAGE_EDUARD_PREOWNED =
    '<!DOCTYPE html><html><head><title>8021 HAWKER TEMPEST Mk.V</title></head><body>' +
    '<div class="col-xs-12 col-sm-9 col-md-9"><div class="product-page"><div class="row">' +
    '<div class="col-md-6 col-sm-6">' +
    '<h1>EDUARD 1/48 8021 HAWKER TEMPEST Mk.V</h1>' +
    '<div class="description"></div>' +
    '<div class="price-availability-block clearfix">' +
    '<div class="price" style="width:100%;">' +
    '<div class="col-xs-12 col-sm-6 padleft0 newpriceblock"></div>' +
    '<div class="col-xs-12 col-sm-6 mobpadleft0 padright0">' +
    '<form action="/basket" method="post">' +
    '<input type="hidden" name="action" value="basketadd">' +
    '<input type="hidden" name="ptype" value="preowned">' +
    '<input type="hidden" name="product_id" value="24124">' +
    '<div class="priceheight">' +
    '<small style="font-weight:bold"><strike>Pre-owned <span style="font-size:14px;">£34.99</span></strike></small><br/>' +
    '<p class="saleprice">Now only <span>£19.99</span></p>' +
    '</div>' +
    '<div style="clear:both; height:20px;"></div>' +
    '<select name="quantity" class="form-control"><option value="">Please Select...</option><option value="1">1</option></select>' +
    '<p class="instock">10 in stock</p>' +
    '<div class="product-page-cart"><button class="btn btn-success" type="submit"> Add to basket</button></div>' +
    '</form>' +
    '</div>' +
    '</div></div></div></div></div>' +
    '</body></html>';

  // /product/skybow-military-1-35-3508-m41a3-walker-bulldog
  // Undiscounted: the price sits in .rrpprice and the saleprice <p> is empty.
  var PAGE_SKYBOW_PLAIN =
    '<!DOCTYPE html><html><head><title>3508 M41A3 WALKER BULLDOG - limited special offer</title></head><body>' +
    '<div class="col-xs-12 col-sm-9 col-md-9"><div class="product-page"><div class="row">' +
    '<div class="col-md-6 col-sm-6">' +
    '<h1>SKYBOW 1/35 3508 M41A3 WALKER BULLDOG - limited special offer</h1>' +
    '<div class="description"></div>' +
    '<div class="price-availability-block clearfix">' +
    '<div class="price" style="width:100%;">' +
    '<div class="col-xs-12 col-sm-6 padleft0 newpriceblock">' +
    '<form action="/basket" method="post">' +
    '<input type="hidden" name="action" value="basketadd">' +
    '<input type="hidden" name="ptype" value="new">' +
    '<input type="hidden" name="product_id" value="12626">' +
    '<div class="priceheight">' +
    '<span class="rrpprice">New <span style="font-size:20px;">£12.99</span></span>' +
    '<p class="saleprice"></p>' +
    '</div>' +
    '<div style="clear:both; height:20px;"></div>' +
    '<select name="quantity" class="form-control"><option value="">Please Select...</option><option value="1" class="qtyNew">1</option></select>' +
    '<p class="instock">7 in stock</p>' +
    '<div class="product-page-cart"><button class="btn btn-success " type="submit"> Add to basket</button></div>' +
    '</form>' +
    '</div>' +
    '<div class="col-xs-12 col-sm-6 mobpadleft0 padright0"></div>' +
    '</div></div></div></div></div>' +
    '</body></html>';

  // Synthetic: a dead product. The real site 301-redirects such URLs to the
  // homepage, which serves 200 but carries neither a product_id input nor a
  // .product-page wrapper — this stands in for both that and a plain 404 body.
  var PAGE_GONE =
    '<!DOCTYPE html><html><head><title>Model Kits | Airfix Models | Tamiya Models | Revell Models | UK Stock</title></head><body>' +
    '<div class="container"><h1>Welcome to King Kit</h1>' +
    '<p>The page you were looking for could not be found.</p>' +
    '<a href="/shop.php">Browse the shop</a></div>' +
    '</body></html>';

  global.WATCH_FIXTURES = {
    PAGE_TAKOM_SALE: PAGE_TAKOM_SALE,
    PAGE_EDUARD_PREOWNED: PAGE_EDUARD_PREOWNED,
    PAGE_SKYBOW_PLAIN: PAGE_SKYBOW_PLAIN,
    PAGE_GONE: PAGE_GONE
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
