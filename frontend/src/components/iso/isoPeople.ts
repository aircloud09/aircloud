/**
 * The people on the isometric floor: a figure and a name chip per person,
 * kept in step with the session by `sync` and moved every frame by the
 * errand rules in `update`. Claude sits at the front dev desk nearest my
 * desk, subagents and colleagues (other sessions' lead agents on this
 * floor) take the next free dev chairs, and I sit behind the reception
 * desk, typing for a moment each time I send a question. Claude rests on
 * the lounge sofa between turns, passing the time with a coffee, its
 * phone, a book or the TV and dozing off after a long rest, and has a
 * coffee in the cafe while its conversation is compacted. `update` also
 * reports what the rooms should show: racks busy while a command runs,
 * code on the screens of people editing, someone writing at the
 * whiteboard, the TV on while someone watches, and the elevator doors open
 * while someone steps in or out.
 *
 * A subagent the backend has just made steps out of the elevator while
 * Claude holds the phone; one whose work is done reports beside Claude,
 * says 「👋 퇴근합니다!」, has a coffee at the cafe and rides the elevator
 * away (작성자 댓글, spec 「라운지 · 카페」).
 */

import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import {
  BREAK_SPOTS,
  CLAUDE_SEAT,
  ELEVATOR_CAB,
  ELEVATOR_DOOR,
  ERRAND_SPOTS,
  MY_SEAT,
  REPORT_SPOTS,
  SUBAGENT_SEATS,
  type IsoSpot,
} from "@/constants/isoFloorPlan";
import {
  ROOM_FOR_ACTIVITY,
  arrivingWalker,
  seatedWalker,
  stepIsoWalker,
  type IsoElevator,
  type IsoGoal,
  type IsoRoomId,
  type IsoWalker,
} from "@/systems/isoErrands";
import { findFloorPath } from "@/systems/isoNavGrid";
import { loungeAct } from "@/systems/loungeActs";
import {
  CHEER_MS,
  NO_PILE,
  bookPile,
  scratchesHead,
  watchesTheClock,
  type BookPile,
} from "@/systems/roomGimmicks";
import { liftLabels, type LabelBox, type Lift } from "@/systems/labelLift";
import { pickBubble, type IsoBubble } from "@/systems/officeBubbles";
import type { IsoPerson, PersonKind } from "@/systems/officePeople";
import { secondsSince } from "@/systems/officeRoster";
import {
  choosePlace,
  placeKey,
  rememberPlace,
  rememberedPlaces,
  remembersAnything,
} from "@/systems/placeMemory";
import {
  bubbleHolder,
  bubbleKey,
  drawBubble,
  type BubbleWords,
} from "./isoBubbles";
import {
  buildCharacter,
  poseCharacter,
  type CharacterRig,
  type PoseAct,
} from "./isoCharacters";
import { OUTFIT_COLORS } from "./isoPalette";

/** Colour of the dot in front of each name, as in the video. */
const DOT_COLORS: Record<Exclude<PersonKind, "subagent">, string> = {
  claude: "#e8735a",
  me: "#4f6fe8",
  colleague: "#e8735a",
};
const dotColor = (person: IsoPerson): string =>
  person.kind === "subagent"
    ? OUTFIT_COLORS[person.outfit]
    : DOT_COLORS[person.kind];

/** The spots of every room people walk to: for a tool, or for a break. */
const ROOM_SPOTS: Record<IsoRoomId, IsoSpot[]> = {
  ...ERRAND_SPOTS,
  ...BREAK_SPOTS,
};
const ROOMS = Object.keys(ROOM_SPOTS) as IsoRoomId[];
const isRoom = (goal: IsoGoal): goal is IsoRoomId =>
  (ROOMS as string[]).includes(goal);

const ELEVATOR: IsoElevator = { door: ELEVATOR_DOOR, cab: ELEVATOR_CAB };
/** Someone this close to the door on the way out has the doors opened (m). */
const DOOR_OPEN_RANGE = 2.2;
/** Deeper in than this behind the door, a person is in the cab: chip and bubble hide (m). */
const IN_CAB_DEPTH = 0.45;
/** How long Claude holds the phone when it calls a subagent in (ms). */
const CALL_MS = 3000;
/** How long I type at my desk after sending a question (ms). */
const ME_TYPING_MS = 4000;

/** What the rooms should show this frame. */
export interface RoomsInUse {
  /** Someone is running a command. */
  serverBusy: boolean;
  /** Seats of people typing at their desks. */
  editingSeats: IsoSpot[];
  /** Someone is planning at the whiteboard. */
  planning: boolean;
  /** Someone is stepping into or out of the elevator. */
  elevatorOpen: boolean;
  /** Someone on the lounge sofa is watching TV. */
  tvOn: boolean;
  /** Someone is searching the web or using an outside (MCP) tool. */
  browsing: boolean;
  /** A newcomer is stepping out of the elevator. */
  arriving: boolean;
}

interface Placed {
  person: IsoPerson;
  rig: CharacterRig;
  chip: CSS2DObject;
  chipText: HTMLSpanElement;
  bubble: CSS2DObject;
  bubbleHolder: HTMLDivElement;
  /** What the bubble shows now, to redraw it only when that changes. */
  bubbleKey: string;
  /** When it started thinking (performance.now ms), while it thinks. */
  thinkingSince: number | null;
  /** When it sat down on the lounge sofa (Date.now ms), while it sits there. */
  loungeSince: number | null;
  /** When its command started (performance.now ms), while one runs. */
  runningSince: number | null;
  /** The books it has piled up reading in the library. */
  pile: BookPile;
  /** When it started typing at its desk (performance.now ms), while it types. */
  typingSince: number | null;
  /** The passed test run it has cheered (or found when placed), and until when it cheers. */
  seenPass: string | null;
  cheerUntil: number;
  walker: IsoWalker;
  seat: IsoSpot;
  /** What it tells Claude when its work is done, read when it gets there. */
  report: string | null;
  /** How far its chip and bubble are lifted clear of a nearer person's (px). */
  lift: number;
  /** Which of its chip and bubble a crowd leaves room for. */
  shown: Lift["show"];
}

function nameChip(color: string): {
  element: HTMLDivElement;
  text: HTMLSpanElement;
} {
  const element = document.createElement("div");
  element.className =
    "flex max-w-[150px] items-center gap-1 whitespace-nowrap rounded-full border border-slate-200/90 bg-white/95 px-2 py-0.5 text-[11px] font-semibold leading-4 text-slate-700 shadow-sm dark:border-slate-700/90 dark:bg-slate-900/90 dark:text-slate-200";
  const dot = document.createElement("span");
  dot.className = "h-1.5 w-1.5 shrink-0 rounded-full";
  dot.style.backgroundColor = color;
  const text = document.createElement("span");
  text.className = "truncate";
  element.append(dot, text);
  return { element, text };
}

export class IsoPeople {
  private readonly placed = new Map<string, Placed>();
  /** Which spot each walker holds in a room, by index into ROOM_SPOTS. */
  private readonly held = Object.fromEntries(
    ROOMS.map((room) => [room, new Map<string, number>()]),
  ) as Record<IsoRoomId, Map<string, number>>;
  /** Which spot beside Claude each reporting subagent holds. */
  private readonly reporting = new Map<string, number>();
  /** Subagents that rode away, kept out until the session lets them go. */
  private readonly departed = new Set<string>();
  /** A newcomer arrived: Claude picks up the phone on the next frame. */
  private callPending = false;
  /** The next sync places a snapshot: everyone starts where they are. */
  private fresh = true;
  /** The chair and room spots each person last had, kept for the tab. */
  private readonly placeOf = rememberedPlaces();
  private callUntil = 0;
  /** Where a chip is on the screen, worked out each frame. */
  private readonly onScreen = new THREE.Vector3();

  private words: BubbleWords = {
    thinking: "",
    thinkingFor: () => "",
    looking: "",
    bye: "",
    compacting: "",
  };

  /** ``onLeft`` hears of each subagent that rode the elevator away. */
  constructor(
    private readonly scene: THREE.Scene,
    private readonly onLeft: (id: string) => void = () => undefined,
  ) {}

  /** Use these words in bubbles from now on. */
  setWords(words: BubbleWords): void {
    this.words = words;
    for (const placed of this.placed.values()) placed.bubbleKey = "redraw";
  }

  /** Add, relabel and remove people to match the session. */
  sync(people: IsoPerson[]): void {
    const ids = new Set(people.map((person) => person.id));
    for (const [id, placed] of this.placed) {
      if (!ids.has(id)) this.remove(id, placed);
    }
    for (const id of this.departed) {
      if (!ids.has(id)) this.departed.delete(id);
    }
    const newcomers: IsoPerson[] = [];
    for (const person of people) {
      const placed = this.placed.get(person.id);
      if (placed) {
        placed.person = person;
        placed.chipText.textContent = person.label;
        continue;
      }
      // Gone home already; it only comes back with new work.
      if (this.departed.has(person.id)) {
        if (person.leaving) continue;
        this.departed.delete(person.id);
      }
      newcomers.push(person);
    }
    // Those who were here before take their places back before anyone new
    // takes the first free one.
    newcomers.sort(
      (a, b) =>
        Number(!remembersAnything(this.placeOf, a.id)) -
        Number(!remembersAnything(this.placeOf, b.id)),
    );
    for (const person of newcomers) {
      const seat = this.freeSeat(person);
      // A snapshot places everyone where they are: only a subagent made while
      // the office watches walks in from the elevator.
      const arriving =
        !this.fresh &&
        person.kind === "subagent" &&
        person.arriving &&
        !person.leaving;
      if (arriving) this.callPending = true;
      const rig = buildCharacter(person.kind, person.outfit);
      const chip = nameChip(dotColor(person));
      chip.text.textContent = person.label;
      const label = new CSS2DObject(chip.element);
      label.center.set(0.5, 1);
      rig.chipAnchor.add(label);
      const holder = bubbleHolder();
      const bubble = new CSS2DObject(holder);
      bubble.center.set(0.5, 1);
      rig.chipAnchor.add(bubble);
      this.scene.add(rig.root);
      this.placed.set(person.id, {
        person,
        rig,
        chip: label,
        chipText: chip.text,
        bubble,
        bubbleHolder: holder,
        bubbleKey: "",
        thinkingSince: null,
        loungeSince: null,
        runningSince: null,
        pile: NO_PILE,
        typingSince: null,
        // A pass from before it was placed is old news: no cheer for it.
        seenPass: person.passedTest,
        cheerUntil: 0,
        walker: this.firstWalker(person, arriving, seat),
        seat,
        report: null,
        lift: 0,
        shown: "all",
      });
    }
    this.fresh = false;
  }

  /** Move and pose everyone for this frame; ``dt`` in seconds. */
  update(now: number, dt: number): RoomsInUse {
    const inUse: RoomsInUse = {
      serverBusy: false,
      editingSeats: [],
      planning: false,
      elevatorOpen: false,
      tvOn: false,
      browsing: false,
      arriving: false,
    };
    if (this.callPending) {
      this.callPending = false;
      this.callUntil = now + CALL_MS;
    }
    const gone: string[] = [];
    // Claude keeps quiet while a subagent reports to it.
    const listening = [...this.placed.values()].some(({ walker }) =>
      isTelling(walker),
    );
    for (const [id, placed] of this.placed) {
      const { activity, stuck, leaving } = placed.person;
      const walker = stepIsoWalker(placed.walker, {
        activity,
        stuck,
        seat: placed.seat,
        spotIn: (room) => this.spotIn(id, room),
        findPath: findFloorPath,
        now,
        dt,
        leaving,
        breakRoom: placed.person.breakRoom,
        reportSpot: () => this.reportSpot(id),
        elevator: ELEVATOR,
      });
      for (const room of ROOMS) {
        if (walker.goal !== room) this.held[room].delete(id);
      }
      if (walker.goal !== "report") this.reporting.delete(id);
      placed.walker = walker;
      if (walker.trip?.kind === "gone") {
        gone.push(id);
        continue;
      }
      const act = this.actOf(placed, now);
      placed.rig.root.position.set(walker.x, 0, walker.z);
      // Waiting on a long command, or cheering on its feet in a room, it
      // turns from the rack or shelf to face the room.
      const facesRoom =
        act === "watch" || (act === "cheer" && walker.pose === "work");
      placed.rig.root.rotation.y = facesRoom
        ? walker.facing + Math.PI
        : walker.facing;
      const calling =
        placed.person.kind === "claude" &&
        now < this.callUntil &&
        walker.pose === "sit";
      poseCharacter(
        placed.rig,
        calling
          ? "phone"
          : isTypingMe(placed.person, walker)
            ? "type"
            : walker.pose,
        isRoom(walker.goal) ? walker.goal : null,
        now / 1000,
        stuck && !leaving,
        act,
      );
      // In the cab, behind its doors: no chip or bubble either.
      const inCab = walker.z < ELEVATOR_DOOR.z - IN_CAB_DEPTH;
      placed.chip.visible = !inCab;
      placed.bubble.visible = !inCab;
      this.showBubble(
        placed,
        activity,
        stuck,
        now,
        listening && placed.person.kind === "claude",
        act,
      );
      if (activity === "running") inUse.serverBusy = true;
      this.stackBooks(placed);
      if (act === "tv") inUse.tvOn = true;
      if (activity === "browsing") inUse.browsing = true;
      if (walker.pose === "type") inUse.editingSeats.push(placed.seat);
      if (walker.goal === "meeting" && walker.pose === "work") {
        inUse.planning = true;
      }
      if (usesElevator(walker)) inUse.elevatorOpen = true;
      if (walker.trip?.kind === "arrive") inUse.arriving = true;
    }
    for (const id of gone) {
      const placed = this.placed.get(id);
      if (placed) this.remove(id, placed);
      this.departed.add(id);
      this.onLeft(id);
    }
    return inUse;
  }

  /**
   * Lift the chips and bubbles that would cover a nearer person's (see
   * systems/labelLift.ts). Call once the labels are drawn for the frame, on
   * a ``width`` × ``height`` px view.
   */
  liftCrowdedLabels(camera: THREE.Camera, width: number, height: number): void {
    const boxes: LabelBox[] = [];
    for (const [id, placed] of this.placed) {
      if (!placed.chip.visible) continue;
      placed.chip.getWorldPosition(this.onScreen).project(camera);
      const chip = placed.chip.element;
      const said = placed.bubbleHolder.firstElementChild as HTMLElement | null;
      boxes.push({
        id,
        x: ((this.onScreen.x + 1) * width) / 2,
        y: ((1 - this.onScreen.y) * height) / 2,
        chip: { width: chip.offsetWidth, height: chip.offsetHeight },
        bubble: said
          ? {
              width: said.offsetWidth,
              height: placed.bubbleHolder.offsetHeight,
            }
          : null,
      });
    }
    const lifts = liftLabels(boxes);
    for (const [id, placed] of this.placed) {
      const { by, show } = lifts.get(id) ?? { by: 0, show: "all" };
      if (by !== placed.lift) {
        placed.lift = by;
        const translate = by ? `0 ${-by}px` : "";
        placed.chip.element.style.translate = translate;
        placed.bubbleHolder.style.translate = translate;
      }
      if (show !== placed.shown) {
        placed.shown = show;
        // Hidden, not removed: they are still measured next frame.
        placed.bubbleHolder.style.visibility = show === "all" ? "" : "hidden";
        placed.chip.element.style.visibility = show === "none" ? "hidden" : "";
      }
    }
  }

  /**
   * What a subagent on its way home says: its result beside Claude (or
   * 「👋 퇴근합니다!」 when it has none), then 「👋 퇴근합니다!」 all the way to
   * the cab. Nothing on the way to Claude; undefined when it is not leaving.
   */
  private tripBubble(placed: Placed): IsoBubble | null | undefined {
    const trip = placed.walker.trip;
    if (!trip || trip.kind === "arrive" || trip.kind === "gone") {
      placed.report = null;
      return undefined;
    }
    if (trip.kind === "report") {
      if (trip.until === null) return null;
      const { bubble } = placed.person;
      placed.report ??= bubble?.type === "speech" ? bubble.text : null;
      return { kind: "speech", text: placed.report ?? this.words.bye };
    }
    return { kind: "speech", text: this.words.bye };
  }

  /** Redraw a person's bubble when what it should show has changed. */
  private showBubble(
    placed: Placed,
    activity: IsoPerson["activity"],
    stuck: boolean,
    now: number,
    quiet: boolean,
    act: PoseAct | null,
  ): void {
    const { person } = placed;
    // From its latest event (a Date.now time, moved onto this frame clock),
    // so seeing it afresh (another session shown, a reload) does not start
    // the count again.
    if (person.thinking)
      placed.thinkingSince =
        person.since === null
          ? (placed.thinkingSince ?? now)
          : now - (Date.now() - person.since);
    else placed.thinkingSince = null;
    const onTrip = quiet ? null : this.tripBubble(placed);
    // Over coffee while compacting it says so instead of thinking aloud;
    // dozing on the sofa it snores.
    const onBreak: IsoBubble | undefined =
      person.breakRoom === "cafe"
        ? { kind: "speech", text: this.words.compacting }
        : act === "doze"
          ? { kind: "speech", text: "💤" }
          : undefined;
    const bubble =
      onTrip !== undefined
        ? onTrip
        : (onBreak ??
          pickBubble({
            bubble: person.bubble,
            bubbleAgeMs:
              person.bubbleAt === null ? null : Date.now() - person.bubbleAt,
            activity,
            stuck,
            thinkingSeconds:
              placed.thinkingSince === null
                ? null
                : secondsSince(placed.thinkingSince, now),
          }));
    const key = bubbleKey(bubble);
    if (key === placed.bubbleKey) return;
    placed.bubbleKey = key;
    drawBubble(placed.bubbleHolder, bubble, this.words);
  }

  /**
   * What it is up to besides its pose: its pastime on the lounge sofa,
   * counted from the last event (or from when it sat down), or checking its
   * watch at the rack once its command has run a while; null otherwise.
   */
  private actOf(placed: Placed, now: number): PoseAct | null {
    const { walker, person } = placed;
    if (person.activity === "running") placed.runningSince ??= now;
    else placed.runningSince = null;
    if (walker.pose === "type") placed.typingSince ??= now;
    else placed.typingSince = null;
    // Its tests just passed: arms up, wherever it is (not mid-walk).
    if (person.passedTest !== placed.seenPass) {
      placed.seenPass = person.passedTest;
      if (person.passedTest !== null) placed.cheerUntil = now + CHEER_MS;
    }
    if (!walker.path && now < placed.cheerUntil) return "cheer";
    const lounging =
      walker.goal === "lounge" && !walker.path && walker.pose === "sit";
    if (!lounging) placed.loungeSince = null;
    if (lounging) {
      const sat = (placed.loungeSince ??= Date.now());
      return loungeAct(Date.now() - (person.idleSince ?? sat));
    }
    if (walker.goal === "server" && walker.pose === "work") {
      const running =
        placed.runningSince === null ? 0 : now - placed.runningSince;
      return watchesTheClock(running) ? "watch" : null;
    }
    if (
      placed.typingSince !== null &&
      scratchesHead(now - placed.typingSince)
    ) {
      return "scratch";
    }
    return null;
  }

  /** Pile a book beside a reader for each new thing it reads in the library. */
  private stackBooks(placed: Placed): void {
    const { walker, person } = placed;
    const pile = bookPile(
      placed.pile,
      walker.goal === "library" && !walker.path && walker.pose === "work",
      person.activity === "reading",
      person.bubbleAt,
    );
    if (pile === placed.pile) return;
    placed.pile = pile;
    placed.rig.pile.children.forEach((book, i) => {
      book.visible = i < pile.count;
    });
  }

  /** Take everyone off the floor; the next `sync` places them afresh. */
  clear(): void {
    for (const [id, placed] of this.placed) this.remove(id, placed);
    this.departed.clear();
    this.fresh = true;
    this.callPending = false;
    this.callUntil = 0;
  }

  dispose(): void {
    this.clear();
  }

  /**
   * Where a newcomer first appears: stepping out of the elevator, already on
   * its break (the lounge sofa, the cafe) when it is on one, already in the
   * room its tool sends it to, or in its seat. Only the elevator is walked:
   * a colleague whose session turns up after the office is drawn (its
   * overview comes on a socket of its own) is already at its work too.
   */
  private firstWalker(
    person: IsoPerson,
    arriving: boolean,
    seat: IsoSpot,
  ): IsoWalker {
    if (arriving) return arrivingWalker(ELEVATOR);
    const { activity, breakRoom } = person;
    if (breakRoom && !activity) {
      return seatedWalker(this.spotIn(person.id, breakRoom), breakRoom);
    }
    const room = activity ? ROOM_FOR_ACTIVITY[activity] : "seat";
    return room === "seat"
      ? seatedWalker(seat)
      : seatedWalker(this.spotIn(person.id, room), room);
  }

  private freeSeat(person: IsoPerson): IsoSpot {
    if (person.kind === "me") return MY_SEAT;
    if (person.kind === "claude") return CLAUDE_SEAT;
    const taken = new Set(
      [...this.placed.values()].map(({ seat }) => SUBAGENT_SEATS.indexOf(seat)),
    );
    const key = placeKey(person.id);
    const free = choosePlace(
      SUBAGENT_SEATS.length,
      taken,
      this.placeOf.get(key),
    );
    const index = free >= 0 ? free : SUBAGENT_SEATS.length - 1;
    rememberPlace(this.placeOf, key, index);
    return SUBAGENT_SEATS[index];
  }

  /** The spot beside Claude a reporting subagent holds, taking the first free one. */
  private reportSpot(id: string): IsoSpot {
    let index = this.reporting.get(id);
    if (index === undefined) {
      const taken = new Set(this.reporting.values());
      const free = REPORT_SPOTS.findIndex((_, i) => !taken.has(i));
      index = free >= 0 ? free : this.reporting.size % REPORT_SPOTS.length;
      this.reporting.set(id, index);
    }
    return REPORT_SPOTS[index];
  }

  /**
   * The spot a walker holds in a room: the one it last had there while that
   * is free, else the first free one.
   */
  private spotIn(id: string, room: IsoRoomId): IsoSpot {
    const spots = ROOM_SPOTS[room];
    const held = this.held[room];
    let index = held.get(id);
    if (index === undefined) {
      const key = placeKey(id, room);
      const free = choosePlace(
        spots.length,
        new Set(held.values()),
        this.placeOf.get(key),
      );
      index = free >= 0 ? free : held.size % spots.length;
      held.set(id, index);
      rememberPlace(this.placeOf, key, index);
    }
    return spots[index];
  }

  private remove(id: string, placed: Placed): void {
    // Removing the chip itself takes its element off the page; removing
    // only the figure would leave the chip behind.
    placed.chip.removeFromParent();
    placed.bubble.removeFromParent();
    this.scene.remove(placed.rig.root);
    placed.rig.root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    for (const room of ROOMS) this.held[room].delete(id);
    this.reporting.delete(id);
    this.placed.delete(id);
  }
}

/** Me at my desk just after sending a question: typing it out. */
function isTypingMe(person: IsoPerson, walker: IsoWalker): boolean {
  return (
    person.kind === "me" &&
    walker.pose === "sit" &&
    person.typedAt !== null &&
    Date.now() - person.typedAt < ME_TYPING_MS
  );
}

/** Beside Claude, telling it the result or saying goodbye. */
function isTelling(walker: IsoWalker): boolean {
  const trip = walker.trip;
  return (
    (trip?.kind === "report" && trip.until !== null) || trip?.kind === "bye"
  );
}

/** Stepping out of or into the cab, or at the door on the way to it. */
function usesElevator(walker: IsoWalker): boolean {
  const kind = walker.trip?.kind;
  if (kind === "arrive" || kind === "board") return true;
  if (kind !== "leave") return false;
  const toDoor = Math.hypot(
    walker.x - ELEVATOR_DOOR.x,
    walker.z - ELEVATOR_DOOR.z,
  );
  return toDoor < DOOR_OPEN_RANGE;
}
