/* Bot Editor module: core.js */
// ==================== TAB SWITCHING ====================
document.querySelectorAll('.tab-bar button').forEach(function(btn){
 btn.addEventListener('click',function(){
  document.querySelectorAll('.tab-bar button').forEach(function(b){b.classList.remove('active')});
  btn.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(function(t){t.classList.remove('active')});
  document.getElementById('tab'+btn.dataset.tab.charAt(0).toUpperCase()+btn.dataset.tab.slice(1)).classList.add('active');
  if(btn.dataset.tab==='library'&&!window._libLoaded){loadLibrary();loadMeta();window._libLoaded=true}
 });
});

// ==================== 通用配置 ====================
var IS_LOCAL_HOST = location.hostname==='localhost'
	|| location.hostname==='127.0.0.1'
	|| location.hostname==='::1'
	|| location.hostname==='[::1]';
var IS_VERCEL_HOST = location.hostname==='editor.teacharm.moe'
	|| location.hostname==='bot-editor.vercel.app'
	|| /\.vercel\.app$/i.test(location.hostname);
// Vercel hosts use the stable same-origin /api rewrite. Non-Vercel mirrors
// still talk directly to the current SongBot Funnel endpoint.
var API_BASE = (IS_LOCAL_HOST || IS_VERCEL_HOST)
	? ''
	: 'https://win-mohsfa7n4b0.tailae715d.ts.net';
var _trackUrl = API_BASE+'/api/visit';
fetch(_trackUrl,{method:'POST'}).catch(function(){});

function toast(msg){var t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(function(){t.classList.remove('show')},2000)}
function pad(n){return n<10?'0'+n:''+n}
function escHtml(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
