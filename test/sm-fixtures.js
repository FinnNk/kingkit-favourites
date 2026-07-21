// Scalemates HTML fixtures, condensed from real responses captured 2026-07-21.
// The class names and structure are verbatim; unrelated page chrome is cut.
(function (global) {
  'use strict';

  // /search.php?fkSECTION[]=Kits&q=roden 434 junkers — one exact hit.
  var SEARCH_RODEN_434 =
    '<section id=results class=mt4><div class="ut mtl">Results found: 1 <em id=srfb></em>&nbsp;</div>' +
    '<h4><a href="/topics/topic.php?id=2660" class="pf">Junkers D.I</a> <span class=ut>Junkers J 9</span>' +
    '<span class="fr ut hi"> <a class=pf href="/search.php?fkSECTION%5B%5D=All&amp;fkGROUPS%5B%5D=%22Aircraft%22&amp;q=*">Aircraft</a> » ' +
    '<a class=pf href="/search.php?fkSECTION%5B%5D=All&amp;fkGROUPS%5B%5D=%22Aircraft%22&amp;fkCATNAME%5B%5D=%22Propeller%22&amp;q=*">Propeller</a> | ' +
    '<img src="/s/images/flags7/32/DR.png" width=16 height=16 alt="DR" title="DR"> <span class=hi>1918</span></span></h4>' +
    '<h5>Static model kits</h5>' +
    '<div class="ac dg bgl cc pr"><a class="al p8 c pf" href="/kits/roden-434-junkers-di--122091" x-w=448 x-s="/products/img/0/9/1/122091-10244-pristine.jpg" >' +
    '<img src="/products/img/0/9/1/122091-10244-t240.jpg" alt="434" title="1:48 Junkers D.I (Roden 434)" width=240 height=144></a>' +
    '<div class="ar p5"><div class=ut>World War I</div>' +
    '<a href="/kits/roden-434-junkers-di--122091" class=pf>Junkers D.I</a> <span class=ut>short-fuselage version</span> ' +
    '<div><img src="/s/images/flags7/32/UA.png" width=16 height=16 alt="UA" title="UA"> Roden 1:48</div>434 <br>' +
    '<div class="nw bgd dib c">2007</div><div class="nw bgb ry c">New parts</div> </div></div>' +
    '<div class=cb>&nbsp;</div></section>';

  // /search.php?...q=special hobby 48206 — two boxings of the same number.
  var SEARCH_SH_48206 =
    '<section id=results class=mt4><div class="ut mtl">Results found: 2</div>' +
    '<h4><a href="/topics/topic.php?id=999" class="pf">Reggiane Re.2005 Sagittario</a>' +
    '<span class="fr ut hi"> <a class=pf href="/search.php?fkGROUPS%5B%5D=%22Aircraft%22&amp;q=*">Aircraft</a> » ' +
    '<a class=pf href="/search.php?fkCATNAME%5B%5D=%22Propeller%22&amp;q=*">Propeller</a></span></h4>' +
    '<h5>Static model kits</h5>' +
    '<div class="ac dg bgl cc pr"><a class="al p8 c pf" href="/kits/special-hobby-sh48206-reggiane-re2005-sagittario--1378940">' +
    '<img src="/products/img/x-t240.jpg" alt="SH48206" title="1:48 Reggiane Re.2005 Sagittario (Special Hobby SH48206)" width=240 height=144></a>' +
    '<div class="ar p5"><div class=ut>World War II</div>' +
    '<a href="/kits/special-hobby-sh48206-reggiane-re2005-sagittario--1378940" class=pf>Reggiane Re.2005 Sagittario</a> ' +
    '<div>Special Hobby 1:48</div>SH48206 <br><div class="nw bgd dib c">2021</div><div class="nw bgb ry c">New decals</div></div></div>' +
    '<div class="ac dg bgl cc pr"><a class="al p8 c pf" href="/kits/special-hobby-sh48206-reggiane-re2005-sagittario--1244101">' +
    '<img src="/products/img/y-t240.jpg" alt="SH48206" title="1:48 Reggiane Re.2005 Sagittario (Special Hobby SH48206)" width=240 height=144></a>' +
    '<div class="ar p5"><div class=ut>World War II</div>' +
    '<a href="/kits/special-hobby-sh48206-reggiane-re2005-sagittario--1244101" class=pf>Reggiane Re.2005 Sagittario</a> ' +
    '<div>Special Hobby 1:48</div>SH48206 <br><div class="nw bgd dib c">2020</div><div class="nw bgb ry c">New tool</div></div></div>' +
    '</section>';

  // A search where the brand differs (an Eduard etch set amongst Academy results).
  var SEARCH_MIXED_BRANDS =
    '<section id=results class=mt4>' +
    '<div class="ac dg bgl cc pr"><a class="al p8 c pf" href="/kits/academy-2159-republic-p-47d-thunderbolt--104627">' +
    '<img title="1:48 Republic P-47D Thunderbolt (Academy 2159)" alt="2159"></a>' +
    '<div class="ar p5"><div class=ut>World War II</div><div>Academy 1:48</div>2159 <br><div class="nw bgd dib c">1998</div></div></div>' +
    '<div class="ac dg bgl cc pr"><a class="al p8 c pf" href="/kits/eduard-fe106-republic-p-47d-20-thunderbolt--159621">' +
    '<img title="1:48 Republic P-47D 20 Thunderbolt (Eduard FE106)" alt="FE106"></a>' +
    '<div class="ar p5"><div class=ut>World War II</div><div>Eduard 1:48</div>FE106 <br><div class="nw bgd dib c">1999</div></div></div>' +
    '</section>';

  var SEARCH_EMPTY =
    '<section id=results class=mt4><div class="ut mtl">Results found: 0 <em id=srfb></em>&nbsp;</div></section>';

  // /kits/roden-434-junkers-di--122091 — page head plus the Markings section
  // (verbatim structure: h6 per operator, li per scheme).
  var KIT_PAGE_RODEN_434 =
    '<!DOCTYPE html><html><head><title>World War I Junkers D.I, Roden 434 (2007)</title>' +
    '<meta property="og:title" content="World War I Junkers D.I, Roden 434 (2007)">' +
    '<meta property="og:description" content="Roden model kit in scale 1:48, 434 is a rebox released in 2007 | Contents, Previews, Reviews, History + Marketplace | Junkers D.I | EAN: 4823017700963">' +
    '</head><body>' +
    '<h3>Markings</h3><h4>Junkers D.I</h4>' +
    '<h6><img src="/s/images/flags7/32/DR.png" loading=lazy width=16 height=16 alt="DR" title="DR"> Deutsche Luftstreitkräfte<span class="nw"> (Imperial German Air Force 1916-1920)</span></h6>' +
    '<ul class=ut>' +
    '<li class="dc p05"><br><span class="nw bgb">1918</span> World War 1 <img src="/s/images/flags7/32/BE.png" width=16 height=16 alt="BE" title="BE"><br>Satin brown, light green, violet, white, light blue' +
    '<li class="dc p05"><span class="nw bgd">5185/18</span><br><span class="nw bgb">1918</span> World War 1 - Western Front <img src="/s/images/flags7/32/BE.png" width=16 height=16 alt="BE" title="BE">' +
    '</ul>' +
    '<h3>Related</h3><h6>Should Not Appear<span class="nw"> (Other Section)</span></h6>' +
    '</body></html>';

  global.SM_FIXTURES = {
    SEARCH_RODEN_434: SEARCH_RODEN_434,
    SEARCH_SH_48206: SEARCH_SH_48206,
    SEARCH_MIXED_BRANDS: SEARCH_MIXED_BRANDS,
    SEARCH_EMPTY: SEARCH_EMPTY,
    KIT_PAGE_RODEN_434: KIT_PAGE_RODEN_434
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
