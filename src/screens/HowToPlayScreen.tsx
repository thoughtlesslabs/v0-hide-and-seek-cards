import { Eye, Shuffle, Skull, Target } from "lucide-react"
import { AppHeader } from "../components/AppHeader"

interface HowToPlayScreenProps { onBack: () => void; onTutorial: () => void }

export function HowToPlayScreen({ onBack, onTutorial }: HowToPlayScreenProps) {
  return (
    <main className="screen scroll-screen">
      <AppHeader eyebrow="How to Play" onBack={onBack} />
      <article className="guide">
        <header className="guide__intro">
        <p className="eyebrow">Simple rules, ridiculous peril</p>
          <h1>Find friends before you’re found</h1>
        <p>Every contestant has one secret card in the haunted deck, and nobody knows who is hiding where.</p>
        </header>

        <ol className="guide-steps">
          <li>
            <span><Target aria-hidden="true" /></span>
            <div><strong>1. Choose someone to seek</strong><p>Pick any contestant still in the round — but not yourself.</p></div>
          </li>
          <li>
            <span><Eye aria-hidden="true" /></span>
            <div><strong>2. Turn over one card</strong><p>Every flip can expose your target, another contestant, or—whoops—yourself.</p></div>
          </li>
          <li>
          <span><Skull aria-hidden="true" /></span>
          <div><strong>3. Let the house decide</strong><p>Find your target and they’re out. Find yourself and the trapdoor gets you. Anyone else is a miss.</p></div>
          </li>
          <li>
            <span><Shuffle aria-hidden="true" /></span>
            <div><strong>4. Every card moves</strong><p>After every reveal — even a miss — all remaining cards change position before the next turn.</p></div>
          </li>
        </ol>

        <section className="shuffle-demo" aria-labelledby="shuffle-demo-title">
          <div>
            <p className="eyebrow">The golden rule</p>
          <h2 id="shuffle-demo-title">Every reveal resets the haunted deck</h2>
          <p>The cards turn face down and jump to new positions before the next player chooses. No numbered spot carries over.</p>
          </div>
          <div className="shuffle-demo__cards" aria-hidden="true">
          <i>↗</i><i className="shuffle-demo__reveal">BOO!</i><i>↙</i>
          </div>
        </section>

        <details className="guide-details">
        <summary>Tips for brave contestants</summary>
          <ul>
            <li>Choose who you want to find before you turn over a card.</li>
            <li>Your own card can be anywhere, so every choice has a little risk.</li>
            <li>Watch the cards move after every reveal, then start fresh.</li>
          </ul>
        </details>

      <div className="guide__actions">
        <button className="button button--ghost" type="button" onClick={onTutorial}>Practice it</button>
        <button className="button button--primary" type="button" onClick={onBack}>Step onto the set</button>
      </div>
      </article>
    </main>
  )
}
