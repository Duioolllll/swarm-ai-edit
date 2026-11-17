import {useState} from 'react';

export function App(){
  const [joined,setJoined]=useState(false);
  return <main className="site">
    <nav className="nav"><a className="brand" href="#">fieldnotes<span>®</span></a><div><a href="#collection">The collection</a><a href="#about">Our approach</a></div><span className="edition">EDITION 004 / 2026</span></nav>
    <section className="hero" id="about">
      <div className="eyebrow"><span className="tiny-square"/> A SPACE FOR THE CONSIDERED</div>
      <h1>Less noise.<br/><em>More intention.</em></h1>
      <div className="hero-bottom"><p>Objects, ideas, and little things<br/>that make the everyday feel different.</p><button className="primary-button" onClick={()=>setJoined(!joined)}>{joined?'You’re on the list ✓':'Discover the collection ↗'}</button></div>
      <div className="artwork" role="img" aria-label="Abstract architectural composition"><div className="arch arch-one"/><div className="arch arch-two"/><div className="art-label">FORM / FUNCTION / EVERYDAY</div><div className="art-number">04</div></div>
    </section>
    <section className="collection" id="collection"><div className="section-head"><span>01 — SELECTED OBJECTS</span><span>MADE TO STAY WITH YOU</span></div><div className="cards">
      <article><div className="object object-one"><div className="vase"/></div><div className="caption"><h2>The quiet vessel</h2><span>No. 001</span></div><p>A study in simple, enduring form.</p></article>
      <article><div className="object object-two"><div className="book"/></div><div className="caption"><h2>Room for thought</h2><span>No. 002</span></div><p>Unwritten pages. Unlimited possibilities.</p></article>
      <article><div className="object object-three"><div className="lamp"/></div><div className="caption"><h2>A softer light</h2><span>No. 003</span></div><p>For the hours that belong to you.</p></article>
    </div></section><footer><span>GOOD THINGS TAKE ATTENTION.</span><span>Fieldnotes Studio © 2026</span></footer>
  </main>;
}
