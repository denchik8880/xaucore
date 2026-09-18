/* =========================================================================
   XAUCORE — the "site closed" page.

   Returned verbatim by middleware.js (prod) and dev-server.js (local) when the
   site is locked and the caller is not the owner. It is FULLY self-contained
   (inline CSS + JS, system fonts, no external requests) so it renders even
   though every other asset request is intercepted. Nothing internal is exposed.
   English by default; a device that chose Russian or Ukrainian in the app (localStorage
   xc_lang, same origin) gets the page in that language.
   ========================================================================= */
export const MAINTENANCE_HTML = `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>XAUCORE — maintenance</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
    background:#f4f5f7;color:#1a1d21;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.45}
  .card{background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(16,24,40,.06),0 1px 2px rgba(16,24,40,.04);
    padding:32px 26px;max-width:400px;width:100%;text-align:center}
  .mark{width:52px;height:52px;border-radius:14px;background:#111418;display:flex;align-items:center;
    justify-content:center;margin:0 auto 18px;font-weight:800;font-size:28px;color:#f5820d}
  h1{font-size:19px;font-weight:800;margin-bottom:8px}
  p{font-size:14px;color:#6b7280}
  .badge{display:inline-block;margin-top:18px;font-size:10px;font-weight:800;letter-spacing:.06em;color:#f5820d;
    background:#fff2e2;border:1px solid #f6cfa0;padding:3px 8px;border-radius:999px}
  .owner{margin-top:22px;border-top:1px solid #e8eaed;padding-top:14px}
  .og{font-size:11px;color:#9aa1ab;cursor:pointer;user-select:none;letter-spacing:.04em}
  .of{display:none;margin-top:12px}
  .of input{width:100%;padding:10px 12px;border:1px solid #e8eaed;border-radius:10px;background:#fbfbfc;
    font-size:14px;font-family:inherit}
  .of button{width:100%;margin-top:8px;padding:11px;border:none;border-radius:10px;background:#111418;color:#fff;
    font-weight:700;font-size:14px;cursor:pointer;font-family:inherit}
  .of button:disabled{opacity:.5}
  .om{font-size:12px;color:#e5342b;margin-top:8px;min-height:14px}
</style></head><body>
<div class="card">
  <div class="mark">X</div>
  <h1 id="mh">The system is temporarily unavailable</h1>
  <p id="mp">Maintenance is under way. Please come back later.</p>
  <div class="badge">DEMO • SYNTHETIC DATA</div>
  <div class="owner">
    <div class="og" id="og">Owner access</div>
    <div class="of" id="of">
      <input id="ok" type="password" autocomplete="off" placeholder="Owner key" aria-label="Owner key">
      <button id="ob" type="button">Sign in</button>
      <div class="om" id="om"></div>
    </div>
  </div>
</div>
<script>
(function(){
  var og=document.getElementById('og'),of=document.getElementById('of'),
      ok=document.getElementById('ok'),ob=document.getElementById('ob'),om=document.getElementById('om');
  var T={en:['XAUCORE — maintenance','The system is temporarily unavailable','Maintenance is under way. Please come back later.','Owner access','Owner key','Sign in','Wrong key','Network error','Owner access is not configured'],
    ru:['XAUCORE — технические работы','Система временно недоступна','Ведутся технические работы. Пожалуйста, зайдите позже.','Доступ владельца','Ключ владельца','Войти','Неверный ключ','Ошибка сети','Владельческий доступ не настроен'],
    uk:['XAUCORE — технічні роботи','Система тимчасово недоступна','Тривають технічні роботи. Будь ласка, зайдіть пізніше.','Доступ власника','Ключ власника','Увійти','Невірний ключ','Помилка мережі','Доступ власника не налаштовано']};
  var lg='en';try{var v=localStorage.getItem('xc_lang');if(v==='ru'||v==='uk')lg=v;}catch(e){}
  var t=T[lg];document.documentElement.lang=lg;document.title=t[0];
  document.getElementById('mh').textContent=t[1];document.getElementById('mp').textContent=t[2];
  og.textContent=t[3];ok.placeholder=t[4];ok.setAttribute('aria-label',t[4]);ob.textContent=t[5];
  function errText(e){return e==='Владельческий доступ не настроен'?t[8]:t[6];}
  og.onclick=function(){var v=of.style.display==='block';of.style.display=v?'none':'block';if(!v)ok.focus();};
  function submit(){
    ob.disabled=true;om.textContent='';
    fetch('/api/owner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:ok.value})})
      .then(function(r){return r.json().then(function(j){return{s:r.ok,j:j};},function(){return{s:r.ok,j:{}};});})
      .then(function(x){if(x.s){location.reload();}else{om.textContent=errText(x.j&&x.j.error);ob.disabled=false;}})
      .catch(function(){om.textContent=t[7];ob.disabled=false;});
  }
  ob.onclick=submit;
  ok.addEventListener('keydown',function(e){if(e.key==='Enter')submit();});
})();
</script>
</body></html>`;
