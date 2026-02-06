import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Clock, MapPin, Tag } from 'lucide-react'
import { readItems, readSingleton } from '@directus/sdk'
import directus from '../lib/directus'

type SponsorLevel = 'root' | 'admin' | 'user' | 'collaborator'

interface Sponsor {
  id: number
  name: string
  level: SponsorLevel
  link: string
  logo: string
}

interface ScheduleItem {
  id: number
  title: string
  start: string
  end: string
  location: string
  tags: string[]
  description?: string
}

interface WifiInfo {
  id: number
  ssid: string
  password: string
}

interface HackingTime {
  id: number
  start: string
  end: string
}

interface AnnouncementInfo {
  id: number
  content?: string
  visible: boolean
}

interface TvData {
  sponsors: Sponsor[]
  schedule: ScheduleItem[]
  wifi: WifiInfo | null
  hacking: HackingTime | null
  announcement: AnnouncementInfo | null
}

const markdownComponents = {
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => <ul className="list-disc list-inside space-y-1" {...props} />,
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
    <ol className="list-decimal list-inside space-y-1" {...props} />
  ),
  li: (props: React.LiHTMLAttributes<HTMLLIElement>) => <li className="ml-0" {...props} />,
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => <p className="mb-1 last:mb-0" {...props} />
}

const DIRECTUS_URL = import.meta.env.VITE_DIRECTUS_URL

function getAssetUrl(id?: string | null) {
  if (!id) return ''
  try {
    const url = new URL(`/assets/${id}`, DIRECTUS_URL)
    return url.toString()
  } catch {
    return `${DIRECTUS_URL.replace(/\/$/, '')}/assets/${id}`
  }
}

function useNow(tickMs: number) {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const interval = setInterval(() => {
      setNow(new Date())
    }, tickMs)
    return () => clearInterval(interval)
  }, [tickMs])

  return now
}

async function fetchTvData(): Promise<TvData> {
  const [sponsors, schedule, wifi, hacking, announcement] = await Promise.all([
    directus.request<Sponsor[]>(readItems('sponsors')).catch(() => [] as Sponsor[]),
    directus.request<ScheduleItem[]>(readItems('schedule', { sort: ['start'] })).catch(() => [] as ScheduleItem[]),
    directus.request<WifiInfo | null>(readSingleton('wifi')).catch(() => null),
    directus.request<HackingTime | null>(readSingleton('hackingtime')).catch(() => null),
    directus.request<AnnouncementInfo | null>(readSingleton('announcement')).catch(() => null)
  ])

  return {
    sponsors: sponsors ?? [],
    schedule: schedule ?? [],
    wifi: wifi ?? null,
    hacking: hacking ?? null,
    announcement: announcement ?? null
  }
}

function formatClockTime(date: Date | null) {
  if (!date) return '--:--'
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

function formatCountdown(hacking: HackingTime | null, now: Date | null) {
  if (!hacking || !now) return '--:--:--'

  const start = new Date(hacking.start)
  const end = new Date(hacking.end)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return '--:--:--'
  }

  if (now < start) {
    // Before hacking starts we always display 36 hours as per spec
    return '36:00:00'
  }

  if (now >= end) {
    // Once it reaches zero, stay at zero
    return '00:00:00'
  }

  const diffMs = end.getTime() - now.getTime()
  const totalSeconds = Math.max(0, Math.floor(diffMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const hh = String(hours).padStart(2, '0')
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')

  return `${hh}:${mm}:${ss}`
}

type ScheduleItemStatus = 'past' | 'live' | 'upcoming'

interface TimedScheduleItem extends ScheduleItem {
  startDate: Date
  endDate: Date
  status: ScheduleItemStatus
}

function buildTimedSchedule(schedule: ScheduleItem[], now: Date | null): TimedScheduleItem[] {
  return schedule
    .map((item) => {
      const startDate = new Date(item.start)
      const endDate = new Date(item.end)
      let status: ScheduleItemStatus = 'upcoming'

      if (now) {
        if (now >= endDate) status = 'past'
        else if (now >= startDate && now < endDate) status = 'live'
        else status = 'upcoming'
      }

      return { ...item, startDate, endDate, status }
    })
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
}

function getActiveScheduleIndex(items: TimedScheduleItem[], now: Date | null): number {
  if (!items.length || !now) return -1

  const liveIndex = items.findIndex((item) => item.status === 'live')
  if (liveIndex !== -1) return liveIndex

  const upcomingIndex = items.findIndex((item) => item.startDate > now)
  if (upcomingIndex !== -1) return upcomingIndex

  return items.length - 1
}

export default function Tv() {
  const [data, setData] = useState<TvData>({
    sponsors: [],
    schedule: [],
    wifi: null,
    hacking: null,
    announcement: null
  })
  const [isLoading, setIsLoading] = useState(true)

  const now = useNow(1000)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const next = await fetchTvData()
        if (!cancelled) {
          setData(next)
          setIsLoading(false)
        }
      } catch (error) {
        console.error('Failed to load TV data', error)
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void load()
    const interval = setInterval(() => {
      void load()
    }, 5000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const timedSchedule = useMemo(() => buildTimedSchedule(data.schedule, now), [data.schedule, now])
  const activeIndex = useMemo(() => getActiveScheduleIndex(timedSchedule, now), [timedSchedule, now])

  const mainSponsor = useMemo(() => data.sponsors.find((s) => s.level === 'root') ?? null, [data.sponsors])
  const secondarySponsors = useMemo(() => data.sponsors.filter((s) => s.level === 'admin'), [data.sponsors])
  const thirdTierSponsors = useMemo(() => data.sponsors.filter((s) => s.level === 'user'), [data.sponsors])
  const collaboratorSponsors = useMemo(() => data.sponsors.filter((s) => s.level === 'collaborator'), [data.sponsors])

  const organizer = useMemo(() => collaboratorSponsors[0] ?? null, [collaboratorSponsors])

  return (
    <div className="h-screen overflow-hidden text-neutral-50 font-sans flex">
      <div className="flex-1 flex flex-col gap-8 px-12 py-10 min-h-0">
        <Header now={now} />
        <HackingCountdown hacking={data.hacking} now={now} />
        <ScheduleList items={timedSchedule} />
      </div>

      <div className="w-lg h-screen flex flex-col border-l border-neutral-900 px-12 py-10 gap-8">
        <div className="flex-1 min-h-0">
          <SponsorsPanel
            mainSponsor={mainSponsor}
            secondarySponsors={secondarySponsors}
            thirdTierSponsors={thirdTierSponsors}
            collaboratorSponsors={collaboratorSponsors}
          />
        </div>
        <div className="flex flex-col gap-4">
          <AnnouncementBanner announcement={data.announcement} />
          <WifiAndOrganizer wifi={data.wifi} />
        </div>
      </div>

      {isLoading ? (
        <div className="pointer-events-none fixed inset-0 flex items-start justify-center pt-4 text-xs text-neutral-600">
          Loading live data…
        </div>
      ) : null}
    </div>
  )
}

interface HeaderProps {
  now: Date | null
}

function Header({ now }: HeaderProps) {
  return (
    <header className="flex items-center justify-between h-16">
      <div className="h-12 w-56 rounded flex items-center justify-start">
        <img src="/images/logo.svg" alt="HackUDC" className="h-12 w-auto object-contain" />
      </div>
      <div className="text-4xl text-neutral-300 tabular-nums">{formatClockTime(now)}</div>
    </header>
  )
}

interface HackingCountdownProps {
  hacking: HackingTime | null
  now: Date | null
}

function HackingCountdown({ hacking, now }: HackingCountdownProps) {
  return (
    <section className="flex flex-col items-center justify-center gap-3 h-44">
      <p className="text-base font-semibold text-neutral-400 tracking-[0.35em] uppercase">HACKING ENDS IN</p>
      <p className="text-8xl md:text-9xl font-mono text-neutral-50 tabular-nums">{formatCountdown(hacking, now)}</p>
    </section>
  )
}

interface ScheduleListProps {
  items: TimedScheduleItem[]
}

function ScheduleList({ items }: ScheduleListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  const firstVisibleIndex = items.findIndex((item) => item.status !== 'past')
  const visibleItems = firstVisibleIndex === -1 ? [] : items.slice(firstVisibleIndex)

  useEffect(() => {
    if (!visibleItems.length) return

    const container = containerRef.current
    const target = itemRefs.current[0]
    if (!container || !target) return

    const containerRect = container.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()

    const currentScrollTop = container.scrollTop
    const offsetWithinContainer = targetRect.top - containerRect.top

    let targetScrollTop = currentScrollTop + offsetWithinContainer

    const maxScrollTop = container.scrollHeight - container.clientHeight
    if (maxScrollTop <= 0) {
      targetScrollTop = 0
    } else {
      if (targetScrollTop < 0) targetScrollTop = 0
      if (targetScrollTop > maxScrollTop) targetScrollTop = maxScrollTop
    }

    container.scrollTo({
      top: targetScrollTop,
      behavior: 'smooth'
    })
  }, [visibleItems.length, visibleItems[0]?.id])

  return (
    <section className="flex flex-col gap-3 flex-1 min-h-0">
      <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500">Schedule</h2>
      <div ref={containerRef} className="flex-1 min-h-0 space-y-3 overflow-y-auto">
        <div className="flex flex-col gap-3 overflow-y-hidden">
          {visibleItems.map((item, index) => (
            <div
              key={item.id}
              ref={(el) => {
                itemRefs.current[index] = el
              }}
            >
              <ScheduleCard item={item} isActive={item.status === 'live'} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

interface ScheduleCardProps {
  item: TimedScheduleItem
  isActive: boolean
}

function ScheduleCard({ item, isActive }: ScheduleCardProps) {
  const startLabel = item.startDate.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  const endLabel = item.endDate.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })

  const durationMs = item.endDate.getTime() - item.startDate.getTime()
  const durationMinutes = Math.max(0, Math.round(durationMs / 60000))
  const durationHours = Math.floor(durationMinutes / 60)
  const durationRemainderMinutes = durationMinutes % 60
  const durationLabel =
    durationHours > 0
      ? durationRemainderMinutes === 0
        ? `${durationHours}h`
        : `${durationHours}h ${durationRemainderMinutes}m`
      : `${durationMinutes}m`

  const baseClasses = 'rounded-lg px-6 py-4 bg-black border flex gap-4'

  let textClasses = 'text-neutral-400'
  let titleClasses = 'text-xl font-semibold'
  let timeClasses = 'text-sm font-medium'
  let statusLabel: string | null = null
  let borderClasses = 'border-neutral-900'
  let liveAccentDot = false

  if (item.status === 'live') {
    textClasses = 'text-amber-100'
    titleClasses = 'text-2xl font-semibold text-neutral-50'
    timeClasses = 'text-base font-medium text-amber-900'
    statusLabel = 'LIVE NOW'
    borderClasses = 'border-amber-400/80 shadow-[0_0_24px_rgba(250,204,21,0.35)]'
    liveAccentDot = true
  } else if (item.status === 'past') {
    textClasses = 'text-neutral-500'
    titleClasses = 'text-xl font-semibold text-neutral-400'
    timeClasses = 'text-sm font-medium text-neutral-500'
  } else if (item.status === 'upcoming') {
    textClasses = 'text-neutral-400'
    titleClasses = 'text-xl font-semibold text-neutral-50'
    timeClasses = 'text-sm font-medium text-neutral-400'
  }

  let relativeTimeLabel: string | null = null
  if (item.status === 'upcoming') {
    const now = new Date()
    const diffMs = item.startDate.getTime() - now.getTime()
    const diffMinutes = Math.round(diffMs / 60000)
    if (diffMinutes > 0) {
      if (diffMinutes < 60) {
        relativeTimeLabel = `Starts in ${diffMinutes} min`
      } else {
        const hours = Math.floor(diffMinutes / 60)
        const minutes = diffMinutes % 60
        relativeTimeLabel = minutes === 0 ? `Starts in ${hours}h` : `Starts in ${hours}h ${minutes}m`
      }
    }
  }

  return (
    <article className={`${baseClasses} ${borderClasses} ${isActive ? 'shadow-[0_0_40px_rgba(0,0,0,0.6)]' : ''}`}>
      <div className="w-40 flex flex-col justify-between border-r border-neutral-800 pr-4 text-xs text-neutral-400 shrink-0">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-neutral-500 shrink-0" />
              <span className="tabular-nums">{startLabel}</span>
              <span className="tabular-nums text-neutral-500">{durationLabel}</span>
            </span>

            <span className="tabular-nums text-neutral-500">→ {endLabel}</span>
          </div>
        </div>
        <div className="mt-2 flex flex-col items-start gap-1 text-[11px] text-neutral-400">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3 w-3 text-neutral-600 shrink-0" />
            <span className="truncate max-w-36">{item.location}</span>
          </span>
          {relativeTimeLabel ? <span>{relativeTimeLabel}</span> : null}
        </div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className={titleClasses}>{item.title}</h3>
          {item.tags && item.tags.length ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
              <Tag className="h-3 w-3 text-neutral-600" />
              <span>{item.tags.join(' · ')}</span>
            </div>
          ) : null}
        </div>
        {item.description ? <ScheduleDescription markdown={item.description} className={textClasses} /> : null}
        <div className="mt-1 flex items-center justify-end gap-3 text-xs text-neutral-500">
          {statusLabel ? (
            <span className="inline-flex items-center gap-2 text-[11px] font-bold text-amber-300 shrink-0">
              {liveAccentDot ? (
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(250,204,21,0.9)] animate-pulse" />
              ) : null}
              <span>{statusLabel}</span>
            </span>
          ) : null}
        </div>
      </div>
    </article>
  )
}

interface ScheduleDescriptionProps {
  markdown: string
  className: string
}

function ScheduleDescription({ markdown, className }: ScheduleDescriptionProps) {
  return (
    <div className={className}>
      <ReactMarkdown components={markdownComponents}>{markdown}</ReactMarkdown>
    </div>
  )
}

interface SponsorsPanelProps {
  mainSponsor: Sponsor | null
  secondarySponsors: Sponsor[]
  thirdTierSponsors: Sponsor[]
  collaboratorSponsors: Sponsor[]
}

function SponsorsPanel({
  mainSponsor,
  secondarySponsors,
  thirdTierSponsors,
  collaboratorSponsors
}: SponsorsPanelProps) {
  return (
    <section className="flex flex-col gap-6 flex-1 min-h-0 overflow-y-auto">
      <div className="flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500">Sponsors</h2>

        <div className="flex flex-col gap-4">
          <div className="h-28 rounded-lg bg-black border border-neutral-900 flex items-center justify-center">
            {mainSponsor ? (
              <SponsorLogo sponsor={mainSponsor} />
            ) : (
              <span className="text-xs text-neutral-600">Main sponsor</span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {secondarySponsors.length ? (
              secondarySponsors.map((sponsor) => (
                <div
                  key={sponsor.id}
                  className="h-16 rounded bg-black border border-neutral-900 flex items-center justify-center"
                >
                  <SponsorLogo sponsor={sponsor} />
                </div>
              ))
            ) : (
              <>
                <PlaceholderBox label="Sponsor" />
                <PlaceholderBox label="Sponsor" />
              </>
            )}
          </div>

          <div className="h-12 rounded bg-black border border-neutral-900 flex items-center justify-center">
            {thirdTierSponsors.length
              ? thirdTierSponsors.map((sponsor) => (
                  <div key={sponsor.id} className="mx-3 h-8 flex items-center">
                    <SponsorLogo sponsor={sponsor} />
                  </div>
                ))
              : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {collaboratorSponsors.length ? (
              collaboratorSponsors.map((sponsor) => (
                <div
                  key={sponsor.id}
                  className="h-14 rounded bg-black border border-neutral-900 flex items-center justify-center"
                >
                  <SponsorLogo sponsor={sponsor} />
                </div>
              ))
            ) : (
              <>
                <PlaceholderBox label="Collaborator" />
                <PlaceholderBox label="Collaborator" />
                <PlaceholderBox label="Collaborator" />
                <PlaceholderBox label="Collaborator" />
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

interface AnnouncementBannerProps {
  announcement: AnnouncementInfo | null
}

function AnnouncementBanner({ announcement }: AnnouncementBannerProps) {
  if (!announcement || !announcement.visible || !announcement.content) return null

  return (
    <section className="rounded-lg border border-amber-400/80 bg-amber-500/10 px-5 py-4 shadow-[0_0_30px_rgba(250,204,21,0.35)] animate-pulse">
      <div className="flex items-center gap-3 mb-2">
        <span className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_12px_rgba(250,204,21,0.9)]" />
        <p className="text-xs font-semibold tracking-[0.25em] uppercase text-amber-300">Announcement</p>
      </div>
      <div className="text-amber-50 text-sm">
        <ReactMarkdown components={markdownComponents}>{announcement.content}</ReactMarkdown>
      </div>
    </section>
  )
}

interface SponsorLogoProps {
  sponsor: Sponsor
}

function SponsorLogo({ sponsor }: SponsorLogoProps) {
  const src = getAssetUrl(sponsor.logo)
  const image = <img src={src} alt={sponsor.name} className="max-h-full max-w-full object-contain" />

  if (sponsor.link) {
    return (
      <a href={sponsor.link} target="_blank" rel="noreferrer" className="inline-flex max-h-full max-w-full">
        {image}
      </a>
    )
  }

  return image
}

interface PlaceholderBoxProps {
  label: string
}

function PlaceholderBox({ label }: PlaceholderBoxProps) {
  return (
    <div className="h-14 rounded bg-black border border-neutral-900 flex items-center justify-center">
      <span className="text-[10px] uppercase tracking-[0.2em] text-neutral-600">{label}</span>
    </div>
  )
}

interface WifiAndOrganizerProps {
  wifi: WifiInfo | null
}

function WifiAndOrganizer({ wifi }: WifiAndOrganizerProps) {
  return (
    <section className="border-t border-neutral-900 pt-5 flex items-center justify-between gap-6 text-sm">
      <div className="flex flex-col gap-1">
        <span className="font-semibold tracking-[0.25em] uppercase text-neutral-400 text-xs">Wi-Fi</span>
        {wifi ? (
          <>
            <span className="text-lg text-neutral-100">{wifi.ssid}</span>
            <span className="text-sm text-neutral-300 mt-1">
              Password: <span className="font-mono tracking-wide text-neutral-50">{wifi.password}</span>
            </span>
          </>
        ) : (
          <span className="text-neutral-500">Wi-Fi info</span>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="font-semibold tracking-[0.25em] uppercase text-neutral-400 text-xs">Organized by</span>
        <div className="h-12 w-24 flex items-center justify-center">
          <img src="/images/gpul.svg" alt="GPUL" className="h-12 w-auto object-contain" />
        </div>
      </div>
    </section>
  )
}
