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

test("an approval whose journal line failed is finished by approving again, and answers the request once", async () => {
  const fixture = createFixtureSource()
  await setSource(fixture)
  try {
    const request = fixture.ask({ block: fixtureIds.scans, store: "block", from: "friends", to: "private", askedBy: "agent:helper" })
    await loadMoveRequests()
    fixture.failing.record = 1
    await assert.rejects(approveMoveRequest(request.id), { name: "NetworkError" })
    const moved = await approveMoveRequest(request.id)
    assert.deepEqual(waitingRequests(), [])
    assert.deepEqual(fixture.journalOfMoves.filter(move => move.request === request.id).map(move => [move.sealedAs, move.state]), [[moved.id, "done"]])
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
    // Public straight to private is refused plainly: friends first, and Publish takes it down.
    await assert.rejects(setVisibility(fixtureIds.slow, "private"), { name: "NotSupportedError" })
  } finally {
    await setSource(null)
  }
})

test("a block that is not a post becomes one when it goes public, at the address its channel gives", async () => {
  const fixture = createFixtureSource()
  await setSource(fixture)
  try {
    const before = byId(fixtureIds.address)!
    assert.notEqual(before.kind, "post")
    const moved = await setVisibility(fixtureIds.address, "public")
    assert.equal(moved.id, fixtureIds.address)
    assert.equal(moved.publish, `https://vault.example.test/vault/?publish=${fixtureIds.address}`)
    const after = byId(fixtureIds.address)!
    assert.deepEqual([after.kind, after.visibility, after.title], ["post", "public", before.title])
    const file = fixture.readBlock({ id: fixtureIds.address, layer: "public", store: "post" })
    assert.match(file.path, /^writing\/essays\/owning-your-address\.md$/)
    assert.deepEqual(fixture.journalOfMoves.at(-1), { block: fixtureIds.address, from: "friends", to: "public", state: "previewed" })
    // Only one copy is left: the friends-only one is gone.
    assert.equal(fixture.listBlocks(["friends"]).some(head => head.id === fixtureIds.address), false)
  } finally {
    await setSource(null)
  }
})

test("someone asking to be a friend waits for the member, who approves them for every channel or only some", async () => {
  const { approveFriend, declineFriend, waitingFriends } = await import("../src/workspace/store")
  const fixture = createFixtureSource()
  const bo = fixture.askFriend({ did: "did:web:pds.bo.example.test", name: "Bo", email: "bo@example.test" })
  const cy = fixture.askFriend({ did: "did:web:pds.cy.example.test", name: "Cy" })
  await setSource(fixture)
  try {
    assert.deepEqual(waitingFriends().map(each => each.name), ["Bo", "Cy"])
    await assert.rejects(approveFriend(bo.id, []), { name: "DataError" })
    await approveFriend(bo.id, ["writing"])
    await declineFriend(cy.id)
    assert.deepEqual(waitingFriends(), [])
    const friends = await fixture.listFriends()
    assert.deepEqual(friends.find(each => each.did === bo.did), { did: bo.did, added: "2026-11-24", channels: ["writing"], name: "Bo", email: "bo@example.test" })
    assert.equal(friends.some(each => each.did === cy.did), false)
  } finally {
    await setSource(null)
  }
})

test("a move to private that sealed its copy but failed after finishes only what is left when moved again: one sealed copy", async () => {
  const fixture = createFixtureSource()
  await setSource(fixture)
  try {
    const sealedCount = () => fixture.listBlocks(["private"]).length
    const before = sealedCount()
    // The friends copy could not be removed: it stays in the tree, and the move says so.
    fixture.failing.delete = 1
    const first = await setVisibility(fixtureIds.address, "private")
    assert.equal(first.cleanupPending, true)
    assert.equal(byId(fixtureIds.address)?.visibility, "friends")
    assert.equal(fixture.journalOfMoves.at(-1)?.state, "cleanup-pending")
    // Moved again, it only removes the friends copy: no second sealed copy, and the journal says done.
    const again = await setVisibility(fixtureIds.address, "private")
    assert.deepEqual([again.id, again.cleanupPending], [first.id, false])
    assert.equal(sealedCount(), before + 1)
    assert.equal(byId(fixtureIds.address), undefined)
    assert.equal(fixture.listBlocks(["friends"]).some(head => head.id === fixtureIds.address), false)
    assert.deepEqual(fixture.journalOfMoves.filter(move => move.sealedAs === first.id).map(move => move.state), ["cleanup-pending", "done"])

    // The journal could not be reached: moved again, the move is only recorded, once.
    fixture.failing.record = 1
    await assert.rejects(setVisibility(fixtureIds.dusk, "private"), { name: "NetworkError" })
    const recorded = await setVisibility(fixtureIds.dusk, "private")
    assert.equal(sealedCount(), before + 2)
    assert.deepEqual(fixture.journalOfMoves.filter(move => move.sealedAs === recorded.id).map(move => [move.block, move.state]), [[fixtureIds.dusk, "done"]])
  } finally {
    await setSource(null)
  }
})
