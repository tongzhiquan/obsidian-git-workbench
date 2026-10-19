const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
module.exports = async function hoverChecks({ window, js, check, capture }) {
  window.show(); window.focus(); await delay(200);
  const move = (x, y) => window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
  const click = async (x, y) => { move(x, y); window.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 }); window.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 }); await delay(100); };
  const rect = selector => js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}})()`);
  const count = () => js("document.querySelectorAll('.gp-blame-card').length");
  const body = await rect('.cm-content');
  const hover = async (waitForDiff=true) => {
    move(body.left+60,body.top+8);await delay(600);
    const a=await rect('.gp-inline-blame');move(a.left+Math.min(a.width/2,80),a.top+a.height/2);await delay(600);
    if(waitForDiff)for(let i=0;i<60;i++){if(await js("document.querySelector('.gp-blame-card-diff')?.getAttribute('aria-busy')==='false'"))break;await delay(50);}
    return a;
  };
  await js("(()=>{window.__qaEditorLeaf=app.workspace.activeLeaf})()");
  move(body.left+80,body.top+6);await delay(700);check(await count()===0,'hovering note text does not trigger a row-start Git tooltip');
  const passive=await js("(()=>{const a=document.querySelector('.gp-inline-blame'),s=getComputedStyle(a);a.click();return {tag:a.tagName,cursor:s.cursor,color:s.color,bg:s.backgroundColor,tab:a.tabIndex,native:a.hasAttribute('title'),card:document.querySelectorAll('.gp-blame-card').length}})()");
  check(passive.tag==='SPAN'&&passive.cursor==='default'&&passive.tab===-1&&!passive.native&&passive.card===0,'inline attribution is passive gray text; click alone opens no card');
  const attribution=await hover();
  const opened=await js("(()=>{const p=document.querySelector('.gp-blame-card'),a=document.querySelector('.gp-inline-blame'),s=getComputedStyle(a),r=p?.getBoundingClientRect();return {cards:document.querySelectorAll('.gp-blame-card').length,pin:!!document.querySelector('.gp-blame-card-pin'),inside:r&&r.left>=12&&r.top>=12&&r.right<=innerWidth-12&&r.bottom<=innerHeight-12,color:s.color,bg:s.backgroundColor,diff:document.querySelector('.gp-blame-change-add code')?.textContent,label:document.querySelector('.gp-blame-card-diff-label')?.textContent}})()");
  check(opened.cards===1&&!opened.pin&&opened.inside&&opened.color===passive.color&&opened.bg===passive.bg,'hover opens one card without pin or purple trigger highlighting');
  check(opened.diff==='# Git Workbench'&&opened.label.includes('首次新增'),'hover card shows real initial-line addition rather than whole-file or working-tree diff');
  const first=await rect('.gp-blame-card');check(first.left>=attribution.left-first.width&&first.left>body.left+80,'card placement follows pointer rather than line start');
  move(Math.max(first.left+10,attribution.left),attribution.bottom+6);await delay(100);move(first.left+30,first.top+60);await delay(800);
  const inside=await rect('.gp-blame-card');check(await count()===1&&inside.left===first.left&&inside.top===first.top,'diagonal move across text lines keeps hover card visible at stable position after diff loads');
  await js("(()=>{window.__qaTextTab=app.workspace.activeLeaf.view.getState();app.workspace.activeLeaf.view.editor.setCursor({line:6,ch:1})})()"); await delay(600);await hover();
  check(await js("(()=>{const row=document.querySelector('.gp-blame-change.is-current').getBoundingClientRect(),list=document.querySelector('.gp-blame-card-diff-lines').getBoundingClientRect();return row.top>=list.top-1&&row.bottom<=list.bottom+1})()"),'diff scroll brings hovered line into view within large initial addition');
  const afterScroll=await rect('.gp-blame-card');move(afterScroll.left+40,afterScroll.top+70);await delay(80);
  await js("document.body.removeClass('theme-dark');document.body.addClass('theme-light')");await capture('git-workbench-hover-diff-light.png');
  await js("document.body.removeClass('theme-light');document.body.addClass('theme-dark')");await capture('git-workbench-hover-diff-dark.png');
  const copy=await rect('.gp-blame-card-copy');await js("(()=>{Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async value=>{window.__qaCopiedSha=value}})})()");await click(copy.left+copy.width/2,copy.top+copy.height/2);
  check(await js("/^[0-9a-f]{40,64}$/.test(window.__qaCopiedSha)&&document.querySelector('.gp-blame-card-feedback')?.textContent==='已复制完整 SHA'"),'card copy action still uses complete SHA');
  move(body.left+30,body.top+220);await delay(700);check(await count()===0,'leaving card closes after grace period without a pinned state');
  await hover();await js("document.querySelector('.gp-inline-blame').click()");move(body.left+30,body.top+220);await delay(700);check(await count()===0,'clicking hovered attribution does not pin or keep card open');
  await hover();window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await delay(150);check(await count()===0,'Escape closes hovering card');
  await hover();await js("document.querySelector('.gp-blame-card-close').click()");await delay(150);check(await count()===0,'close button restores editor focus without reopening');
  await hover();await js("document.querySelector('.cm-scroller').dispatchEvent(new Event('scroll'))");check(await count()===0,'scroll dismisses hovering card');
  await hover();const history=await rect('.gp-blame-card-history');await click(history.left+history.width/2,history.top+history.height/2);await delay(450);
  check(await js("app.workspace.getLeavesOfType('git-workbench-workbench')[0].view.tab==='history'&&document.querySelector('.gp-history-path')?.textContent==='笔记库/项目笔记.md'"),'card file history opens correct note');
  await js("app.workspace.revealLeaf(window.__qaEditorLeaf)");await delay(650);await hover();const commit=await rect('.gp-blame-card-primary');await click(commit.left+commit.width/2,commit.top+commit.height/2);await delay(450);
  check(await js("app.workspace.getLeavesOfType('git-workbench-workbench')[0].view.tab==='graph'&&!!document.querySelector('.gp-commit-detail h3')"),'card commit action opens attributed commit');
  await js("app.workspace.revealLeaf(window.__qaEditorLeaf)");await delay(650);await hover();await click(body.left+50,body.top+190);check(await count()===0,'outside click closes hovering card');
  window.setSize(1100,850);await delay(500);await hover();check(await js("(()=>{const r=document.querySelector('.gp-blame-card').getBoundingClientRect();return r.left>=12&&r.right<=innerWidth-12&&r.top>=12&&r.bottom<=innerHeight-12})()"),'card with line diff fits narrow window');await capture('git-workbench-hover-diff-narrow.png');
  await js("document.querySelector('.gp-blame-card-close').click()");window.setSize(1600,1000);await delay(400);
  await js("app.workspace.activeLeaf.view.editor.setCursor({line:0,ch:1})");await delay(300);
  await js("(()=>{const c=app.plugins.plugins['git-workbench'].controller;window.__qaLineChange=c.lineChange;c.lineChange=()=>new Promise(r=>{window.__qaResolveDiff=r});const a=document.querySelector('.gp-inline-blame'),r=a.getBoundingClientRect();a.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,clientX:r.left+30,clientY:r.top+5}))})()");
  for(let i=0;i<40;i++){if(await js("document.querySelector('.gp-blame-card-diff')?.getAttribute('aria-busy')==='true'"))break;await delay(50);}
  check(await js("document.querySelector('.gp-blame-card-diff')?.getAttribute('aria-busy')==='true'"),'delayed line query displays loading state');
  await js("(()=>{document.querySelector('.gp-blame-card-close').click();window.__qaResolveDiff({label:'stale',lines:[],truncated:false});const c=app.plugins.plugins['git-workbench'].controller;c.lineChange=window.__qaLineChange})()");await delay(120);check(await count()===0,'late line diff response does not reopen closed card');
  for(let attempt=0;attempt<3;attempt++){await hover();if(await count()===1)break;const fresh=await rect('.cm-content');move(fresh.left+30,fresh.top+160);await delay(700);}
  check(await count()===1,'hover card ready for edit invalidation');
};
