// Which channels someone sees: every channel, or the top-level channels ticked (each covering the
// channels inside it). The same picker approves a friend and changes what a friend sees.
import { Checkbox } from "@/components/ui/checkbox"
import { channelRecords } from "@/data/workspace-data"

export type Picked = { every: boolean; channels: string[] }
export const pickedOf = (channels: "*" | string[] | undefined): Picked => (!channels || channels === "*" ? { every: true, channels: [] } : { every: false, channels })
export const chosen = (picked: Picked): "*" | string[] => (picked.every ? "*" : picked.channels)
export const pickedNothing = (picked: Picked) => !picked.every && !picked.channels.length

export function ChannelPicker({ value, onChange }: { value: Picked; onChange: (next: Picked) => void }) {
  const top = [...new Set([...channelRecords.map(channel => channel.path.split("/")[0]), ...value.channels])].sort()
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-2 text-body">
        <Checkbox checked={value.every} onCheckedChange={every => onChange({ ...value, every: Boolean(every) })} /> Every channel
      </label>
      {!value.every && top.map(path => (
        <label key={path} className="flex items-center gap-2 ps-6 text-body">
          <Checkbox checked={value.channels.includes(path)}
            onCheckedChange={on => onChange({ ...value, channels: on ? [...value.channels, path] : value.channels.filter(each => each !== path) })} />
          {path}
        </label>
      ))}
    </div>
  )
}
