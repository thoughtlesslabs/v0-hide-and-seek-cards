import { useReducer } from "react"
import { Check, MousePointer2, Shuffle, Skull, Target } from "lucide-react"

import { Avatar } from "../components/Avatar"
import { feedback } from "../lib/feedback"
import { INITIAL_TUTORIAL_STATE, tutorialReducer } from "../lib/tutorial"

interface TutorialScreenProps {
  playerName: string
  onComplete: () => void
  onSkip: () => void
}

const COPY = {
  target: { eyebrow: "Your turn · Step 1 of 4", title: "Choose Rowan", body: "First, pick the contestant you want to find." },
  card: { eyebrow: "Target locked · Step 2 of 4", title: "Flip Rowan's card", body: "In a real game you won't know where Rowan is hiding. For practice, pick the glowing card." },
  reveal: { eyebrow: "Found! · Step 3 of 4", title: "Rowan gets the trapdoor", body: "Finding your target eliminates them. Finding your own card would eliminate you." },
  shuffle: { eyebrow: "One last rule · Step 4 of 4", title: "Shuffle every card", body: "After every reveal, all surviving cards move. Treat every turn as a fresh table." },
  ready: { eyebrow: "Tutorial complete", title: "You know enough to cause trouble", body: "Choose a target, flip one card, and survive. The game handles the rest." },
} as const

export function TutorialScreen({ playerName, onComplete, onSkip }: TutorialScreenProps) {
  const [state, dispatch] = useReducer(tutorialReducer, INITIAL_TUTORIAL_STATE)
  const copy = COPY[state.stage]
  const revealed = state.stage === "reveal"

  function chooseTarget(id: string) {
    if (id === "rowan" && state.stage === "target") feedback.cue("target")
    dispatch({ type: "choose-target", playerId: id })
  }

  function chooseCard(id: string) {
    if (id === "rowan" && state.stage === "card") feedback.cue("flip")
    dispatch({ type: "choose-card", cardId: id })
  }

  return (
    <main className="screen tutorial-screen">
      <header className="tutorial-topbar">
        <span className="tutorial-topbar__brand"><Skull aria-hidden="true" />Hide &amp; Seek</span>
        <button type="button" onClick={onSkip}>Skip tutorial</button>
      </header>

      <section className="tutorial-copy" aria-live="polite">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
      </section>

      <section className={`tutorial-table tutorial-table--${state.stage}`} aria-label="Practice table">
        <div className="tutorial-targets" aria-label="Contestants">
          {([
            ["lyra", playerName],
            ["rowan", "Rowan"],
            ["mira", "Mira"],
          ] as const).map(([id, name]) => (
            <button
              className={`tutorial-player ${state.stage === "target" && id === "rowan" ? "tutorial-player--prompt" : ""} ${state.stage !== "target" && id === "rowan" ? "tutorial-player--selected" : ""}`}
              type="button"
              key={id}
              onClick={() => chooseTarget(id)}
              disabled={state.stage !== "target"}
            >
              <Avatar avatarId={id} name={name} size="md" />
              <span>{name}</span>
              {id === "rowan" && state.stage !== "target" && <Target aria-label="Selected target" />}
            </button>
          ))}
        </div>

        <div className="tutorial-cards" aria-label="Hidden character cards">
          {state.cardOrder.map((id) => {
            const isPrompt = state.stage === "card" && id === "rowan"
            return (
              <button
                className={`tutorial-card ${isPrompt ? "tutorial-card--prompt" : ""} ${revealed && id === "rowan" ? "tutorial-card--revealed" : ""}`}
                type="button"
                key={id}
                onClick={() => chooseCard(id)}
                disabled={state.stage !== "card"}
              >
                <span className="tutorial-card__inner">
                  <span className="tutorial-card__back"><Skull aria-hidden="true" /><small>Pick me</small></span>
                  <span className="tutorial-card__face"><Avatar avatarId="rowan" name="Rowan" size="lg" /><strong>Rowan</strong><i>FOUND!</i></span>
                </span>
              </button>
            )
          })}
        </div>

        {state.stage === "target" && <p className="tutorial-nudge"><Target aria-hidden="true" /> Tap Rowan's portrait</p>}
        {state.stage === "card" && <p className="tutorial-nudge"><MousePointer2 aria-hidden="true" /> Tap the glowing card</p>}
        {state.stage === "reveal" && (
          <button className="button button--primary tutorial-action" type="button" onClick={() => dispatch({ type: "continue" })}>
            Got it
          </button>
        )}
        {state.stage === "shuffle" && (
          <button className="button button--primary tutorial-action" type="button" onClick={() => { feedback.cue("tap"); dispatch({ type: "shuffle" }) }}>
            <Shuffle aria-hidden="true" /> Shuffle the table
          </button>
        )}
        {state.stage === "ready" && (
          <button className="button button--primary tutorial-action" type="button" onClick={onComplete}>
            <Check aria-hidden="true" /> Start playing
          </button>
        )}
      </section>
    </main>
  )
}
