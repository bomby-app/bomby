import { expect, test } from "vite-plus/test"

import { callFailure } from "./call-failure"

test("a call the voice model ended says why", () => {
  expect(
    callFailure({
      "bomby.failure": "OpenAI ended the call: You have no credits remaining.",
      "lk.agent.state": "listening",
    })
  ).toBe("OpenAI ended the call: You have no credits remaining.")
})

test("a call that goes on says nothing", () => {
  expect(callFailure({})).toBeNull()
  expect(callFailure({ "lk.agent.state": "listening" })).toBeNull()
  expect(callFailure({ "bomby.failure": "  " })).toBeNull()
})
