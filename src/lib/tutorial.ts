export type TutorialStage = "target" | "card" | "reveal" | "shuffle" | "ready"

export interface TutorialState {
  stage: TutorialStage
  cardOrder: readonly string[]
}

export type TutorialAction =
  | { type: "choose-target"; playerId: string }
  | { type: "choose-card"; cardId: string }
  | { type: "continue" }
  | { type: "shuffle" }
  | { type: "restart" }

export const INITIAL_TUTORIAL_STATE: TutorialState = {
  stage: "target",
  cardOrder: ["lyra", "rowan", "mira"],
}

export function tutorialReducer(state: TutorialState, action: TutorialAction): TutorialState {
  if (action.type === "restart") return INITIAL_TUTORIAL_STATE
  if (state.stage === "target" && action.type === "choose-target" && action.playerId === "rowan") {
    return { ...state, stage: "card" }
  }
  if (state.stage === "card" && action.type === "choose-card" && action.cardId === "rowan") {
    return { ...state, stage: "reveal" }
  }
  if (state.stage === "reveal" && action.type === "continue") {
    return { ...state, stage: "shuffle" }
  }
  if (state.stage === "shuffle" && action.type === "shuffle") {
    return { stage: "ready", cardOrder: ["mira", "lyra", "rowan"] }
  }
  return state
}
