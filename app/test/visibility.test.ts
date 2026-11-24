// Visibility moves in the cockpit: one handler for the control, an approved agent request and the
// visibility.move tool; every move journalled; what an agent hid is sealed when the home opens.
import assert from "node:assert/strict"
import test from "node:test"
import { byId } from "../src/data/workspace-data"
import {
  approveMoveRequest, declineMoveRequest, loadMoveRequests, previewMove, setSource, setVisibility, waitingRequests,
} from "../src/workspace/store"
import { createFixtureSource, fixtureIds } from "./fixtures/fixture-source"

test("the preview is the shared rules: what a move does, and what it still needs", async () => {
  const fixture = createFixtureSource()
  await setSource(fixture)
  try {
    const share = previewMove(fixtureIds.monday, "friends")
    assert.deepEqual([share.action, share.widens, share.finishes], ["share", true, "member"])
    const takedown = previewMove(fixtureIds.garden, "friends")
    assert.deepEqual([takedown.action, takedown.via], ["takedown", "publish"])
    assert.throws(() => previewMove(fixtureIds.garden, "public"), { name: "DataError" })
  } finally {
    await setSource(null)
  }
})

test("an agent's request waits until the member approves it, and the move is the same handler's, journalled with who asked", async () => {
  const fixture = createFixtureSource()
  await setSource(fixture)
  try {
    assert.deepEqual(waitingRequests(), [])
    const request = fixture.ask({ block: fixtureIds.address, store: "block", from: "friends", to: "private", askedBy: "agent:helper", reason: "Too personal." })
    await loadMoveRequests()
    assert.deepEqual(waitingRequests().map(each => each.id), [request.id])
    // Nothing moved by asking.
    assert.equal(byId(fixtureIds.address)?.visibility, "friends")
    const moved = await approveMoveRequest(request.id)
    assert.equal(moved.visibility, "private")
    assert.equal(byId(moved.id)?.visibility, "private")
    assert.deepEqual(waitingRequests(), [])
    const last = fixture.journalOfMoves.at(-1)!
    assert.deepEqual([last.block, last.from, last.to, last.request, last.sealedAs, last.state], [fixtureIds.address, "friends", "private", request.id, moved.id, "done"])
    // A request already answered cannot be approved again.
    await assert.rejects(approveMoveRequest(request.id), { name: "NotFoundError" })
  } finally {
    await setSource(null)
  }
})

test("declining moves nothing; a request for a block that changed since is reviewed again", async () => {
  const fixture = createFixtureSource()
  await setSource(fixture)
  try {
    const declined = fixture.ask({ block: fixtureIds.scans, store: "block", from: "friends", to: "public", askedBy: "agent:helper" })
    const stale = fixture.ask({ block: fixtureIds.dusk, store: "block", from: "friends", to: "private", askedBy: "agent:helper", version: "an-older-version" })
    await loadMoveRequests()
    await declineMoveRequest(declined.id)
    assert.equal(byId(fixtureIds.scans)?.visibility, "friends")
    assert.equal(fixture.journalOfMoves.at(-1)?.state, "declined")
    await assert.rejects(approveMoveRequest(stale.id), { name: "InvalidStateError" })
    assert.equal(byId(fixtureIds.dusk)?.visibility, "friends")
  } finally {
    await setSource(null)
  }
})

test("what an agent hid is sealed into the private layer when the home opens, and journalled", async () => {
  const fixture = createFixtureSource()
  fixture.hide(fixtureIds.scans)
  await setSource(fixture)
  try {
    const sealed = fixture.journalOfMoves.find(move => move.block === fixtureIds.scans)
    assert.ok(sealed, "the seal is journalled")
    assert.deepEqual([sealed.from, sealed.to, sealed.state], ["friends", "private", "done"])
    assert.equal(byId(sealed.sealedAs!)?.visibility, "private")
  } finally {
    await setSource(null)
  }
})

test("a post to or from public is marked here and finished on the Publish page, which shows that post alone", async () => {
  const fixture = createFixtureSource()
  await setSource(fixture)
  try {
    const down = await setVisibility(fixtureIds.garden, "friends")
    assert.equal(down.publish, `https://vault.example.test/vault/?publish=${fixtureIds.garden}`)
    assert.equal(byId(fixtureIds.garden)?.visibility, "friends")
    assert.equal(fixture.journalOfMoves.at(-1)?.state, "previewed")
    const up = await setVisibility(fixtureIds.garden, "public")
    assert.ok(up.publish)
    // A block that is not a post, and public straight to private, are refused plainly.
    await assert.rejects(setVisibility(fixtureIds.address, "public"), { name: "NotSupportedError" })
    await assert.rejects(setVisibility(fixtureIds.slow, "private"), { name: "NotSupportedError" })
  } finally {
    await setSource(null)
  }
})
