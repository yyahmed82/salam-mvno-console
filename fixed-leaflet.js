/* fixed-leaflet.js — key-free map engine for the Fixed pages (OpenStreetMap tiles via Leaflet).
 * Used automatically when Google Maps is unavailable (no GMAPS_KEY, referrer-restricted key, offline CDN).
 * Loads Leaflet 1.9.4 + markercluster 1.5.3 from cdnjs once. API:
 *   window.fxLeaflet.render(el, pins, opts) → Promise<boolean>   pins: [{lat,lng,color,r,title,label,onClick}]
 *   opts: { dark, polyline:[[lat,lng]…], cluster:true|false, fit:true }                                */
(function(){
  "use strict";
  const CSS="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
  const JS ="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
  const MC_CSS=["https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.min.css","https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.Default.min.css"];
  const MC_JS ="https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.min.js";
  const css=h=>{ if(document.querySelector(`link[href="${h}"]`)) return; const l=document.createElement("link"); l.rel="stylesheet"; l.href=h; document.head.appendChild(l); };
  const js=s=>new Promise((res,rej)=>{ if(document.querySelector(`script[src="${s}"]`)) return res(); const e=document.createElement("script"); e.src=s; e.async=true; e.onload=()=>res(); e.onerror=()=>rej(new Error("failed "+s)); document.head.appendChild(e); });
  let P=null;
  function load(){
    if(window.L&&window.L.map) return Promise.resolve(true);
    if(P) return P;
    css(CSS); MC_CSS.forEach(css);
    P=js(JS).then(()=>js(MC_JS).catch(()=>{})).then(()=>!!(window.L&&window.L.map)).catch(()=>{ P=null; return false; });
    return P;
  }
  const maps=new WeakMap();   // el → { map, layer, tiles }
  async function render(el, pins, opts={}){
    if(!(await load())) return false;
    const L=window.L;
    let st=maps.get(el);
    if(!st||!el.isConnected||!el.querySelector(".leaflet-container")){
      el.innerHTML=""; el.style.minHeight=el.style.minHeight||"420px";
      const map=L.map(el,{center:[23.8,45.0],zoom:6,zoomControl:true,attributionControl:true,preferCanvas:true});
      const dark=!!opts.dark;
      const tiles=L.tileLayer(dark?"https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png":"https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        {maxZoom:19,subdomains:"abcd",attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'});
      tiles.on("tileerror",()=>{ if(!tiles.__fb){ tiles.__fb=true; tiles.setUrl("https://tile.openstreetmap.org/{z}/{x}/{y}.png"); } });
      tiles.addTo(map);
      const home=L.control({position:"bottomright"}); home.onAdd=()=>{ const b=L.DomUtil.create("button"); b.textContent="⌂ KSA"; b.title="Reset view to Saudi Arabia";
        b.style.cssText="background:#fff;border:0;border-radius:3px;box-shadow:0 1px 4px rgba(0,0,0,.3);padding:7px 12px;font:600 12px/1 system-ui,sans-serif;cursor:pointer;color:#333";
        b.onclick=e=>{ e.stopPropagation(); map.setView([23.8,45.0],6); }; return b; }; home.addTo(map);
      st={map,tiles,layer:null,dark}; maps.set(el,st);
      setTimeout(()=>map.invalidateSize(),50);
    }
    if(st.layer){ st.map.removeLayer(st.layer); st.layer=null; }
    const useCluster=opts.cluster!==false && L.markerClusterGroup && pins.length>60;
    const group=useCluster?L.markerClusterGroup({maxClusterRadius:48,showCoverageOnHover:false,spiderfyOnMaxZoom:true,
        iconCreateFunction:c=>L.divIcon({html:`<div style="width:38px;height:38px;border-radius:50%;background:rgba(14,159,90,.85);color:#fff;font:700 12px/38px system-ui;text-align:center;box-shadow:0 0 0 6px rgba(14,159,90,.25)">${c.getChildCount()}</div>`,className:"",iconSize:[38,38]})})
      :L.layerGroup();
    pins.forEach(p=>{ if(p.lat==null||p.lng==null) return;
      const m=p.label
        ? L.marker([p.lat,p.lng],{icon:L.divIcon({html:`<div style="width:22px;height:22px;border-radius:50%;background:${p.color||"#2563eb"};border:2px solid #fff;color:#05121c;font:700 10px/18px system-ui;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.4)">${p.label}</div>`,className:"",iconSize:[22,22],iconAnchor:[11,11]})})
        : L.circleMarker([p.lat,p.lng],{radius:p.r||5,color:"#fff",weight:1,fillColor:p.color||"#2563eb",fillOpacity:.9});
      if(p.title) m.bindTooltip(p.title,{direction:"top",offset:[0,-6]});
      if(p.onClick) m.on("click",p.onClick);
      group.addLayer(m); });
    group.addTo(st.map); st.layer=group;
    if(st.poly){ st.map.removeLayer(st.poly); st.poly=null; }
    if(opts.polyline&&opts.polyline.length>1){ st.poly=L.polyline(opts.polyline,{color:"#3fb6f5",weight:2,opacity:.8}).addTo(st.map); }
    if(opts.fit&&pins.length){ try{ st.map.fitBounds(L.latLngBounds(pins.filter(p=>p.lat!=null).map(p=>[p.lat,p.lng])).pad(0.2),{maxZoom:12}); }catch(e){} }
    setTimeout(()=>st.map.invalidateSize(),80);
    return true;
  }
  window.fxLeaflet={ render, load };
})();
