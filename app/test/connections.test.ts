// Connections: the people around you, and making friends by email.
import assert from "node:assert/strict"
import test from "node:test"
import { askFriend, loadPeople, openShared, removeFriend, setFriendChannels, setSource, useWorkspace } from "../src/workspace/store"
import { createFixtureSource } from "./fixtures/fixture-source"

test("connections lists who you let in, who let you in, and who you asked by email", async () => {
  const fixture = createFixtureSource()
  await setSource(fixture)
  try {
    const before = await loadPeople()
    assert.ok(before.friends.length > 0)
    assert.equal(before.sharers.length, 1)
    await assert.rejects(askFriend("not an email"), { name: "DataError" })
    assert.deepEqual(await askFriend("  Ada@Example.test ", "Hi"), { email: "ada@example.test", asked: true })
    const after = await loadPeople()
    assert.deepEqual(after.asks.map(ask => [ask.email, ask.state]), [["ada@example.test", "waiting"]])
    const [first] = before.friends
    await removeFriend(first.did)
    assert.equal((await loadPeople()).friends.some(friend => friend.did === first.did), false)
    openShared(before.sharers[0].did, "some-id")
    assert.equal(typeof useWorkspace, "function")
  } finally {
    await setSource(null)
  }
})

test("the friends page changes which channels a friend sees, never to nothing", async () => {
  const fixture = createFixtureSource()
  await setSource(fixture)
  try {
    const [friend] = (await loadPeople()).friends
    await assert.rejects(setFriendChannels(friend.did, []), { name: "DataError" })
    await assert.rejects(setFriendChannels(friend.did, ["../x"]), { name: "DataError" })
    await setFriendChannels(friend.did, ["writing", "photos"])
    assert.deepEqual((await loadPeople()).friends.find(each => each.did === friend.did)?.channels, ["writing", "photos"])
    await setFriendChannels(friend.did, "*")
    assert.equal((await loadPeople()).friends.find(each => each.did === friend.did)?.channels, "*")
  } finally {
    await setSource(null)
  }
})
