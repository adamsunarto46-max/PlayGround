(() => {
  const canvas = document.getElementById('world');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const ui = {
    speed: $('speed'), rpm: $('rpm'), gear: $('gear'), rpmProgress: $('rpmProgress'), distance: $('distance'), odometer: $('odometer'),
    engineTemp: $('engineTemp'), coolantTemp: $('coolantTemp'), oilPressure: $('oilPressure'), battery: $('battery'),
    engineMeter: $('engineMeter'), coolantMeter: $('coolantMeter'), oilMeter: $('oilMeter'), batteryMeter: $('batteryMeter'), fuelMeter: $('fuelMeter'), fuelText: $('fuelText'), heading: $('heading'),
    toast: $('toast'), sound: $('soundToggle'), soundState: $('soundState')
  };
  let W = innerWidth, H = innerHeight, dpr = 1, last = 0, elapsed = 0, distance = 0;
  let vehicle, controls = { gas:false, brake:false, left:false, right:false }, flakes = [], audio = null, soundOn = false;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mix = (a,b,t) => a+(b-a)*t;
  const hash = n => { const x=Math.sin(n*127.1+311.7)*43758.5453; return x-Math.floor(x); };
  function terrain(x) {
    const base = H * .745;
    return base + Math.sin(x*.0034)*20 + Math.sin(x*.0081+1.8)*9 + Math.sin(x*.0014+4)*27 + Math.sin(x*.025)*2.1 + (hash(Math.floor(x/115))-0.5)*7;
  }
  function reset() {
    const x = 120;
    vehicle = { x, y:terrain(x)-55, vx:0, vy:0, angle:0, av:0, spin:0, fuel:84, engine:78, coolant:72, wheelSpin:0, wheels:[{x:0,y:0},{x:0,y:0}], rpm:850, gear:'D' };
    distance=0;
    showToast('BELT UP · HAVE A SAFE DRIVE');
  }
  function resize() {
    W=innerWidth; H=innerHeight; dpr=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.round(W*dpr); canvas.height=Math.round(H*dpr); canvas.style.width=W+'px'; canvas.style.height=H+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
    flakes=Array.from({length:Math.max(45,Math.round(W*H/11500))},()=>({x:Math.random()*W,y:Math.random()*H,r:.45+Math.random()*1.5,s:.4+Math.random()*1.1,drift:(Math.random()-.5)*.45,a:.22+Math.random()*.55}));
    if(vehicle) vehicle.y=Math.min(vehicle.y,terrain(vehicle.x)-48);
  }
  function showToast(text) { ui.toast.textContent=text; ui.toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>ui.toast.classList.remove('show'),2100); }
  function keyControl(key, down) {
    const k=key.toLowerCase();
    if(['arrowup','w'].includes(k)) controls.gas=down;
    if(['arrowdown','s',' '].includes(k)) controls.brake=down;
    if(['arrowleft','a'].includes(k)) controls.left=down;
    if(['arrowright','d'].includes(k)) controls.right=down;
    if(down && k==='r') reset();
  }
  addEventListener('keydown',e=>{ if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault(); keyControl(e.key,true); });
  addEventListener('keyup',e=>keyControl(e.key,false));
  addEventListener('blur',()=>{controls={gas:false,brake:false,left:false,right:false};});
  document.querySelectorAll('[data-control]').forEach(button=>{
    const key=button.dataset.control;
    button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);controls[key]=true;});
    ['pointerup','pointercancel','lostpointercapture'].forEach(type=>button.addEventListener(type,()=>controls[key]=false));
  });
  $('resetButton').addEventListener('click',reset);
  $('soundToggle').addEventListener('click',()=>{
    soundOn=!soundOn; ui.soundState.textContent=soundOn?'ON':'OFF'; ui.sound.classList.toggle('sound-on',soundOn);
    if(soundOn) startAudio(); else if(audio){audio.osc.stop();audio=null;}
  });
  function startAudio(){
    try{const AudioContext=window.AudioContext||window.webkitAudioContext;if(!AudioContext)return;const ac=new AudioContext(),osc=ac.createOscillator(),gain=ac.createGain(),filter=ac.createBiquadFilter();osc.type='sawtooth';filter.type='lowpass';filter.frequency.value=210;gain.gain.value=.0001;osc.connect(filter);filter.connect(gain);gain.connect(ac.destination);osc.start();audio={ac,osc,gain,filter};}catch(_){soundOn=false;ui.soundState.textContent='OFF';}
  }
  function update(dt) {
    const v=vehicle, throttle=controls.gas?1:0, braking=controls.brake?1:0;
    const speed=Math.abs(v.vx), traction=clamp(1-speed/140,.3,1);
    const engineForce=throttle * (0.13 + clamp((150-speed)/150,0,1)*.23);
    v.vx += engineForce * (v.vx<0?1:1) * dt * 60;
    if(braking){ if(v.vx>0) v.vx=Math.max(0,v.vx-.31*dt*60); else v.vx=Math.min(0,v.vx+.17*dt*60); }
    v.vx *= Math.pow(throttle||braking?0.999:0.994,dt*60);
    v.vx=clamp(v.vx,-3.3,9.3);
    v.x += v.vx*dt*60;
    const steer=(controls.left?1:0)-(controls.right?1:0);
    const airborne=terrain(v.x)- (v.y+54) > 24;
    v.av += (steer*(airborne?.0038:.0011) - v.angle*.0008)*dt*60;
    v.av *= Math.pow(.982,dt*60);
    let forceY=.31, torque=0;
    const axles=[-43,43];
    for(let i=0;i<2;i++){
      const lx=axles[i], ax=v.x+Math.cos(v.angle)*lx, ay=v.y+Math.sin(v.angle)*lx+10;
      const ground=terrain(ax), rest=24, radius=18;
      const restBottom=ay+rest+radius, compression=clamp(restBottom-ground,0,24);
      const localVy=v.vy + v.av*lx;
      const spring=Math.max(0,compression*.036 + localVy*.018);
      forceY-=spring;
      torque += -spring*lx*.000085;
      const wheelY=ground-radius;
      v.wheels[i]={x:ax,y:wheelY,compression};
    }
    v.vy += forceY*dt*60;
    v.y += v.vy*dt*60;
    const pitchTarget=steer*(airborne?.0028:.00065);
    v.av += torque*dt*60 + (pitchTarget-v.angle)*.00014*dt*60;
    v.angle += v.av*dt*60;
    if(v.angle>Math.PI) v.angle-=Math.PI*2; if(v.angle< -Math.PI) v.angle+=Math.PI*2;
    if(v.y>H+120){reset();return;}
    if(v.x<0)v.x=0;
    v.wheelSpin+=v.vx*.052*dt*60;
    distance+=Math.max(0,v.vx)*dt*60/5000;
    const targetRpm=850+throttle*(1800+Math.min(speed,100)*45)+(braking?120:0)+Math.abs(v.av)*1800;
    v.rpm=mix(v.rpm,clamp(targetRpm,850,6750),.07);
    v.gear=v.vx < -0.5?'R':v.vx<.3?'D':v.vx<2.1?'1':v.vx<4.2?'2':v.vx<6.4?'3':'4';
    v.engine=mix(v.engine,78+throttle*17+speed*.04,.008); v.coolant=mix(v.coolant,72+throttle*9,.004);
    v.fuel=Math.max(0,v.fuel-throttle*.000024*dt*60);
    if(audio&&soundOn){audio.ac.resume();audio.osc.frequency.setTargetAtTime(36+v.rpm*.07,audio.ac.currentTime,.08);audio.gain.gain.setTargetAtTime(.017+throttle*.018,audio.ac.currentTime,.1);audio.filter.frequency.setTargetAtTime(130+v.rpm*.06,audio.ac.currentTime,.1);}
  }
  function drawBackground(camX,camY) {
    const sky=ctx.createLinearGradient(0,0,0,H);sky.addColorStop(0,'#cbdce4');sky.addColorStop(.52,'#dfe9ed');sky.addColorStop(1,'#edf3f4');ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
    const haze=ctx.createRadialGradient(W*.61,H*.3,4,W*.61,H*.3,H*.56);haze.addColorStop(0,'rgba(255,255,255,.62)');haze.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=haze;ctx.fillRect(0,0,W,H*.83);
    // distant rounded winter hills
    for(let layer=0;layer<3;layer++){
      const parallax=.12+layer*.11, base=H*(.51+layer*.052), offset=camX*parallax;
      ctx.beginPath();ctx.moveTo(0,H);
      for(let x=-50;x<=W+50;x+=8){const wx=x+offset;const y=base+Math.sin(wx*.003+layer)*13+Math.sin(wx*.008+layer*2)*6;ctx.lineTo(x,y-camY*.12);}
      ctx.lineTo(W,H);ctx.closePath();ctx.fillStyle=['#c5d6dc','#b5cbd2','#a8c0c8'][layer];ctx.globalAlpha=[.34,.4,.32][layer];ctx.fill();ctx.globalAlpha=1;
    }
    drawPines(camX,camY);
  }
  function drawPines(camX,camY) {
    const spacing=86;
    for(let layer=0;layer<2;layer++){
      const par=layer===0?.34:.53, gap=spacing*(layer===0?1.8:1), worldStart=Math.floor((camX*par-120)/gap), count=Math.ceil(W/gap)+4;
      for(let i=worldStart;i<worldStart+count;i++){
        const x=i*gap-camX*par, rnd=hash(i+layer*911), h=(72+rnd*95)*(layer===0?.72:1), base=H*(layer===0?.74:.77)-camY*(layer===0?.27:.46)+Math.sin(i*.39)*10;
        if(x<-100||x>W+100)continue;
        ctx.globalAlpha=(layer===0?.25:.43)*(0.65+rnd*.35);ctx.fillStyle=layer===0?'#607e84':'#456970';
        ctx.beginPath();ctx.moveTo(x,base-h);ctx.lineTo(x-h*.29,base-h*.35);ctx.lineTo(x-h*.16,base-h*.34);ctx.lineTo(x-h*.43,base);ctx.lineTo(x+h*.42,base);ctx.lineTo(x+h*.15,base-h*.34);ctx.lineTo(x+h*.28,base-h*.35);ctx.closePath();ctx.fill();
        ctx.fillStyle='rgba(239,247,247,.7)';ctx.beginPath();ctx.moveTo(x,base-h);ctx.lineTo(x-h*.29,base-h*.35);ctx.lineTo(x-h*.13,base-h*.42);ctx.lineTo(x,base-h*.53);ctx.lineTo(x+h*.12,base-h*.4);ctx.closePath();ctx.fill();
      }
    }
    ctx.globalAlpha=1;
  }
  function drawGround(camX,camY) {
    const start=camX-120,end=camX+W+120;
    ctx.beginPath();ctx.moveTo(start,terrain(start));for(let x=start;x<=end;x+=7)ctx.lineTo(x,terrain(x));ctx.lineTo(end,H+250);ctx.lineTo(start,H+250);ctx.closePath();
    const snow=ctx.createLinearGradient(0,H*.68,0,H);snow.addColorStop(0,'#f8fbfb');snow.addColorStop(.08,'#f0f5f5');snow.addColorStop(1,'#d5e2e5');ctx.fillStyle=snow;ctx.fill();
    ctx.beginPath();for(let x=start;x<=end;x+=8){const y=terrain(x)+9; if(x===start)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.lineTo(end,H+220);ctx.lineTo(start,H+220);ctx.closePath();ctx.fillStyle='rgba(160,184,192,.18)';ctx.fill();
    // faint frozen tire grooves following the country road
    for(let lane=0;lane<2;lane++){
      ctx.beginPath();for(let x=start;x<=end;x+=8){const y=terrain(x)+21+lane*11;if(x===start)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.strokeStyle=lane===0?'rgba(130,157,166,.14)':'rgba(255,255,255,.7)';ctx.lineWidth=lane===0?5:3;ctx.stroke();
    }
    ctx.beginPath();for(let x=start;x<=end;x+=9){const y=terrain(x);if(x===start)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.strokeStyle='rgba(255,255,255,.97)';ctx.lineWidth=4;ctx.stroke();
    for(let i=Math.floor(start/65);i<Math.ceil(end/65);i++){const x=i*65+hash(i+51)*30,y=terrain(x)-3-hash(i+9)*2;ctx.fillStyle='rgba(255,255,255,.82)';ctx.beginPath();ctx.ellipse(x,y,2+hash(i+89)*3,.8,0,0,Math.PI*2);ctx.fill();}
  }
  function drawVehicle() {
    const v=vehicle;
    // headlamp pools, set behind the silhouette
    const front=v.x+Math.cos(v.angle)*70, frontY=v.y+Math.sin(v.angle)*70;
    ctx.save();ctx.translate(front,frontY);ctx.rotate(v.angle);
    const beam=ctx.createLinearGradient(0,0,170,0);beam.addColorStop(0,'rgba(255,241,192,.19)');beam.addColorStop(1,'rgba(255,245,211,0)');ctx.fillStyle=beam;ctx.beginPath();ctx.moveTo(0,-12);ctx.lineTo(175,-56);ctx.lineTo(175,35);ctx.closePath();ctx.fill();ctx.restore();
    for(const wheel of v.wheels){
      ctx.save();ctx.translate(wheel.x,wheel.y);ctx.rotate(v.wheelSpin);
      ctx.fillStyle='#28343a';ctx.beginPath();ctx.arc(0,0,18,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#52646a';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,14.4,0,Math.PI*2);ctx.stroke();
      ctx.strokeStyle='rgba(205,218,220,.45)';ctx.lineWidth=1.3;for(let j=0;j<8;j++){ctx.rotate(Math.PI/4);ctx.beginPath();ctx.moveTo(0,-12);ctx.lineTo(0,-8);ctx.stroke();}
      ctx.rotate(-v.wheelSpin);ctx.fillStyle='#a8b7b9';ctx.beginPath();ctx.arc(0,0,7.3,0,Math.PI*2);ctx.fill();ctx.fillStyle='#62767b';ctx.beginPath();ctx.arc(0,0,3.2,0,Math.PI*2);ctx.fill();ctx.restore();
    }
    ctx.save();ctx.translate(v.x,v.y);ctx.rotate(v.angle);
    // suspension arms
    ctx.strokeStyle='#59676a';ctx.lineWidth=3;for(const x of [-43,43]){ctx.beginPath();ctx.moveTo(x,12);ctx.lineTo(x,28);ctx.stroke();}
    // lower chassis silhouette
    ctx.fillStyle='#37464c';ctx.beginPath();ctx.roundRect(-58,7,117,11,3);ctx.fill();
    // body shell
    const bodyGrad=ctx.createLinearGradient(0,-38,0,22);bodyGrad.addColorStop(0,'#8e9ba0');bodyGrad.addColorStop(.24,'#77858b');bodyGrad.addColorStop(.66,'#626f75');bodyGrad.addColorStop(1,'#4d5b62');
    ctx.fillStyle=bodyGrad;ctx.beginPath();ctx.moveTo(-58,8);ctx.lineTo(-58,-13);ctx.quadraticCurveTo(-57,-20,-49,-22);ctx.lineTo(-37,-24);ctx.lineTo(-19,-42);ctx.quadraticCurveTo(-15,-46,-6,-46);ctx.lineTo(23,-45);ctx.quadraticCurveTo(32,-44,39,-34);ctx.lineTo(50,-28);ctx.quadraticCurveTo(59,-27,61,-18);ctx.lineTo(62,4);ctx.quadraticCurveTo(60,12,52,13);ctx.lineTo(-50,13);ctx.quadraticCurveTo(-59,12,-58,8);ctx.closePath();ctx.fill();
    // roof rack and glass
    ctx.strokeStyle='#58686e';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-20,-47);ctx.lineTo(23,-47);ctx.stroke();
    ctx.fillStyle='#b8ced3';ctx.beginPath();ctx.moveTo(-14,-41);ctx.lineTo(-4,-41);ctx.lineTo(-4,-26);ctx.lineTo(-33,-26);ctx.closePath();ctx.fill();
    ctx.fillStyle='#abc3c9';ctx.beginPath();ctx.moveTo(0,-41);ctx.lineTo(21,-40);ctx.quadraticCurveTo(28,-39,33,-29);ctx.lineTo(0,-27);ctx.closePath();ctx.fill();
    ctx.strokeStyle='rgba(51,67,73,.65)';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(-2,-42);ctx.lineTo(-2,-25);ctx.moveTo(24,-39);ctx.lineTo(24,-26);ctx.stroke();
    // doors and rugged trim
    ctx.strokeStyle='rgba(42,55,61,.65)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(-1,-23);ctx.lineTo(-1,5);ctx.moveTo(32,-23);ctx.lineTo(33,4);ctx.moveTo(-42,-15);ctx.lineTo(45,-15);ctx.stroke();
    ctx.fillStyle='#aeb8ba';ctx.fillRect(9,-12,8,2);ctx.fillRect(38,-12,7,2);
    ctx.fillStyle='#36464d';ctx.fillRect(-53,2,106,5);ctx.fillStyle='#89979b';ctx.fillRect(-50,3,101,1);
    ctx.fillStyle='#e3c88e';ctx.shadowColor='rgba(255,224,153,.85)';ctx.shadowBlur=12;ctx.fillRect(55,-12,4,7);ctx.shadowBlur=0;
    ctx.fillStyle='#b66f69';ctx.fillRect(-58,-11,3,8);
    // roof lights / side mirror
    ctx.fillStyle='#57676d';ctx.fillRect(35,-30,8,3);ctx.fillRect(-34,-29,7,4);
    ctx.fillStyle='rgba(224,235,235,.65)';ctx.fillRect(-27,-3,8,1);ctx.restore();
  }
  function drawSnow() {
    for(const f of flakes){f.x-=f.drift+vehicle.vx*.04;f.y+=f.s;if(f.y>H+3){f.y=-3;f.x=Math.random()*W;}if(f.x<-3)f.x=W+2;if(f.x>W+3)f.x=-2;ctx.globalAlpha=f.a;ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(f.x,f.y,f.r,0,Math.PI*2);ctx.fill();}
    ctx.globalAlpha=1;
  }
  function render(now) {
    const dt=Math.min(.033,(now-last)/1000||.016);last=now;elapsed+=dt;update(dt);
    const v=vehicle, camX=v.x-W*.36, camY=clamp(v.y-H*.57,-H*.15,H*.2);
    drawBackground(camX,camY);
    ctx.save();ctx.translate(-camX,-camY);drawGround(camX,camY);drawVehicle();ctx.restore();
    drawSnow();
    updateHud();requestAnimationFrame(render);
  }
  function updateHud(){
    const v=vehicle,speed=Math.round(Math.abs(v.vx)*9.2),rpm=Math.round(v.rpm),ratio=clamp((rpm-700)/5700,0,1);
    ui.speed.textContent=String(speed).padStart(2,'0');ui.rpm.textContent=String(rpm).padStart(4,'0');ui.gear.textContent=v.gear;ui.rpmProgress.style.width=(ratio*100)+'%';
    ui.distance.textContent=distance.toFixed(2);ui.odometer.textContent=(distance+132.4).toFixed(1).padStart(5,'0')+' KM';
    ui.engineTemp.textContent=Math.round(v.engine);ui.coolantTemp.textContent=Math.round(v.coolant);ui.oilPressure.textContent=(1.8+v.rpm/6500*1.7).toFixed(1);ui.battery.textContent=(14.1+Math.sin(elapsed*.8)*.12).toFixed(1);
    ui.engineMeter.style.width=clamp(v.engine/125*100,12,100)+'%';ui.coolantMeter.style.width=clamp(v.coolant/115*100,12,100)+'%';ui.oilMeter.style.width=clamp((1.8+v.rpm/6500*1.7)/4.5*100,12,100)+'%';ui.batteryMeter.style.width='78%';ui.fuelMeter.style.width=v.fuel+'%';ui.fuelText.textContent=Math.round(v.fuel)+'%';
    ui.heading.textContent=String(Math.round((42+v.angle*18+360)%360)).padStart(3,'0')+'°';
  }
  resize();reset();addEventListener('resize',resize);requestAnimationFrame(render);
})();
