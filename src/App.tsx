import React, { useState, useEffect, useRef, useCallback } from "react";
import html2canvas from "html2canvas"; // Import html2canvas
import "./App.css";

const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const slots = ["AM", "PM"] as const; // 'as const' for stricter type inference
const rooms = [
  "Room A",
  "Room B",
  "Room C",
  "Room D",
  "Biz 2",
  "CLB",
  "L4 Pod",
  "UHC",
  "BTC",
];
const therapists = [
  "Dominic Yeo",
  "Kirsty Png",
  "Soon Jiaying",
  "Andrew Lim",
  "Janice Leong",
  "Oliver Tan",
  "Claudia Ahl",
  "Seanna Neo",
  "Xiao Hui",
  "Tika Zainal",
];

type SlotType = typeof slots[number]; // Type alias for 'AM' | 'PM'

type SchedulerState = {
  [day: string]: {
    [slot: string]: {
      [room: string]: string; // therapist name or empty string
    };
  };
};

type TherapistAvailabilityRules = {
  [therapistName: string]: {
    availableDays: string[]; // Days they are generally available for office work
    wfhDays: string[]; // Days designated as Work From Home (cannot be assigned to a room)
    availableSlots: SlotType[]; // Slots they are generally available (e.g., AM, PM)
    maxConsecutiveSlotsPerDay: 1 | 2; // Max 1 (AM or PM) or 2 (both AM & PM)
  };
};

// New type for therapist counts
type TherapistCounts = {
  [therapistName: string]: {
    totalSlots: number;
    roomDistribution: { [room: string]: number };
  };
};

/**
 * Normalizes a partial schedule state into a full schedule state,
 * filling in empty strings for unassigned slots.
 * @param schedule - The partial schedule state.
 * @returns A normalized SchedulerState.
 */
function normalizeSchedule(schedule: Partial<SchedulerState>): SchedulerState {
  const normalized: SchedulerState = {};
  for (const day of days) {
    normalized[day] = {};
    for (const slot of slots) {
      normalized[day][slot] = {};
      for (const room of rooms) {
        normalized[day][slot][room] = schedule?.[day]?.[slot]?.[room] ?? "";
      }
    }
  }
  return normalized;
}

/**
 * Initializes default availability rules for all therapists:
 * available all days/slots, no WFH, can work both AM/PM.
 * @returns Default TherapistAvailabilityRules.
 */
function initializeDefaultAvailability(): TherapistAvailabilityRules {
  const defaultRules: TherapistAvailabilityRules = {};
  therapists.forEach((therapist) => {
    defaultRules[therapist] = {
      availableDays: [...days],
      wfhDays: [],
      availableSlots: [...slots],
      maxConsecutiveSlotsPerDay: 2,
    };
  });
  return defaultRules;
}

/**
 * Generates a unique ID based on the current timestamp.
 * @returns A string representing the current timestamp.
 */
function generateId(): string {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${year}${month}${day}T${hour}${minute}${second}${ms}`;
}

export default function App() {
  // State for the main schedule data
  const [schedule, setSchedule] = useState<SchedulerState>(() =>
    normalizeSchedule({})
  );
  // State for messages (e.g., save confirmation)
  const [savedMsg, setSavedMsg] = useState("");
  // State to control weekly or daily view
  const [viewType, setViewType] = useState<"weekly" | "daily">("weekly");
  // State for the currently selected day in daily view
  const [selectedDay, setSelectedDay] = useState<string>(days[0]);
  // State for displaying current date and time
  const [currentTime, setCurrentTime] = useState<string>("");
  // State to control visibility of the rules configuration panel
  const [showRulesPanel, setShowRulesPanel] = useState(false);
  // NEW State for collapsible room overview panel
  const [isRoomOverviewCollapsed, setIsRoomOverviewCollapsed] = useState(false);

  // State for therapist availability rules, loaded from localStorage or initialized
  const [therapistRules, setTherapistRules] = useState<TherapistAvailabilityRules>(() => {
    const savedRules = localStorage.getItem("therapist_rules");
    if (savedRules) {
      try {
        const parsedRules = JSON.parse(savedRules);
        // Ensure all therapists and new rule fields are present after parsing
        therapists.forEach((t) => {
          if (!parsedRules[t]) {
            parsedRules[t] = initializeDefaultAvailability()[t];
          } else {
            // Initialize new rule fields if they were missing from older saved data
            if (parsedRules[t].wfhDays === undefined) parsedRules[t].wfhDays = [];
            if (parsedRules[t].maxConsecutiveSlotsPerDay === undefined)
              parsedRules[t].maxConsecutiveSlotsPerDay = 2;
            if (!Array.isArray(parsedRules[t].availableSlots)) {
              // Ensure it's an array
              parsedRules[t].availableSlots = [...slots];
            }
          }
        });
        return parsedRules;
      } catch (e) {
        console.error("Failed to parse saved therapist rules:", e);
        return initializeDefaultAvailability();
      }
    }
    return initializeDefaultAvailability();
  });

  // State for therapist slot assignment counts (for display fairness)
  const [therapistSlotCounts, setTherapistSlotCounts] = useState<TherapistCounts>({});

  // Ref to keep track of the last assigned therapist index for round-robin distribution
  const lastAssignedIndex = useRef(0);

  // Ref for the schedule table container to capture it as an image
  const scheduleTableRef = useRef<HTMLDivElement>(null);

  /**
   * Determines if a specific UHC cell should be visually greyed out
   * and blocked for assignment based on the UHC room restriction rules.
   * @param day - The day of the slot.
   * @param slot - The time slot (AM/PM).
   * @param room - The room of the slot.
   * @returns True if the UHC cell should be greyed out and blocked, false otherwise.
   */
  const isUHCBlocked = (day: string, slot: SlotType, room: string): boolean => {
    if (room === "UHC") {
      // UHC is only allowed on Wed AM and Thu PM
      const allowedWedAM = day === "Wed" && slot === "AM";
      const allowedThuPM = day === "Thu" && slot === "PM";
      return !(allowedWedAM || allowedThuPM);
    }
    return false; // Not UHC room, so not blocked by this specific UHC rule
  };

  /**
   * Effect to load schedule from localStorage on component mount.
   * Checks for a schedule ID in the URL parameters.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (id) {
      const saved = localStorage.getItem(`schedule_${id}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setSchedule(normalizeSchedule(parsed));
          console.log("Loaded schedule from localStorage id:", id);
        } catch {
          console.warn("Failed to parse saved schedule");
        }
      } else {
        console.log("No saved schedule found for id:", id);
      }
    }
  }, []); // Empty dependency array: runs once on mount

  /**
   * Effect to save therapist rules to localStorage whenever they change.
   */
  useEffect(() => {
    localStorage.setItem("therapist_rules", JSON.stringify(therapistRules));
  }, [therapistRules]); // Dependency array: runs when therapistRules state changes

  /**
   * Effect to update and display the current date and time every second.
   */
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const options: Intl.DateTimeFormatOptions = {
        weekday: "long", // e.g., 'Monday'
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false, // 24-hour format
      };
      setCurrentTime(now.toLocaleDateString(undefined, options));
    };

    updateTime(); // Call initially to set time immediately
    const intervalId = setInterval(updateTime, 1000); // Update every second

    // Cleanup function: clear the interval when the component unmounts
    return () => clearInterval(intervalId);
  }, []); // Empty dependency array: runs once on mount and cleans up on unmount

  /**
   * Effect to calculate and update therapist slot counts whenever the schedule changes.
   */
  useEffect(() => {
    const calculateTherapistCounts = () => {
      const newCounts: TherapistCounts = {};
      therapists.forEach((t) => {
        newCounts[t] = {
          totalSlots: 0,
          roomDistribution: {},
        };
        rooms.forEach((r) => (newCounts[t].roomDistribution[r] = 0));
      });

      // Iterate through the current schedule to count assignments
      for (const day of days) {
        for (const slot of slots) {
          for (const room of rooms) {
            const assignedTherapist = schedule[day][slot][room];
            if (assignedTherapist && newCounts[assignedTherapist]) {
              newCounts[assignedTherapist].totalSlots++;
              newCounts[assignedTherapist].roomDistribution[room]++;
            }
          }
        }
      }
      setTherapistSlotCounts(newCounts);
    };

    calculateTherapistCounts();
  }, [schedule]); // Dependency array: runs whenever the schedule state changes

  /**
   * Handles the start of a drag operation for a therapist from the list.
   * @param e - The React DragEvent.
   * @param therapist - The name of the therapist being dragged.
   */
  function onDragStartTherapist(e: React.DragEvent<HTMLDivElement>, therapist: string) {
    e.dataTransfer.setData("therapistName", therapist);
    e.dataTransfer.setData("sourceType", "list");
    e.dataTransfer.effectAllowed = "move";
  }

  /**
   * Handles the start of a drag operation for a therapist from a schedule cell.
   * @param e - The React DragEvent.
   * @param therapist - The name of the therapist being dragged.
   * @param fromDay - The day the therapist is dragged from.
   * @param fromSlot - The slot the therapist is dragged from.
   * @param fromRoom - The room the therapist is dragged from.
   */
  function onDragStartCell(
    e: React.DragEvent<HTMLDivElement>,
    therapist: string,
    fromDay: string,
    fromSlot: string,
    fromRoom: string
  ) {
    e.dataTransfer.setData("therapistName", therapist);
    e.dataTransfer.setData("sourceType", "cell");
    e.dataTransfer.setData("sourceLocation", JSON.stringify({ day: fromDay, slot: fromSlot, room: fromRoom }));
    e.dataTransfer.effectAllowed = "move";
  }

  /**
   * Handles the drop of a therapist onto a schedule cell.
   * @param e - The React DragEvent.
   * @param toDay - The day the therapist is dropped onto.
   * @param toSlot - The slot the therapist is dropped onto.
   * @param toRoom - The room the therapist is dropped onto.
   */
  function onDropCell(
    e: React.DragEvent<HTMLTableCellElement>,
    toDay: string,
    toSlot: SlotType, // Use SlotType here
    toRoom: string
  ) {
    e.preventDefault();
    e.currentTarget.classList.remove("drag-over"); // Remove drag-over styling

    // Prevent dropping into blocked UHC slots
    if (isUHCBlocked(toDay, toSlot, toRoom)) {
      setSavedMsg("Cannot assign to UHC at this time.");
      setTimeout(() => setSavedMsg(""), 3000);
      return;
    }

    const therapistName = e.dataTransfer.getData("therapistName");
    const sourceType = e.dataTransfer.getData("sourceType");
    const sourceLocationData = e.dataTransfer.getData("sourceLocation");

    if (!therapistName) return; // Exit if no therapist data

    setSchedule((prev) => {
      const newSchedule = JSON.parse(JSON.stringify(prev)) as SchedulerState; // Deep copy previous schedule

      // If dragging from another cell, clear the source cell
      if (sourceType === "cell" && sourceLocationData) {
        const { day: fromDay, slot: fromSlot, room: fromRoom } = JSON.parse(sourceLocationData);
        // Only clear if moving to a different slot/room, not dropping back onto itself
        if (!(fromDay === toDay && fromSlot === toSlot && fromRoom === toRoom)) {
          if (newSchedule[fromDay]?.[fromSlot]?.[fromRoom] === therapistName) {
            newSchedule[fromDay][fromSlot][fromRoom] = "";
          }
        }
      }
      // Assign the therapist to the target cell
      newSchedule[toDay][toSlot][toRoom] = therapistName;
      return newSchedule;
    });
  }

  /**
   * Prevents default behavior and sets drop effect during drag over.
   * @param e - The React DragEvent.
   */
  function onDragOverCell(e: React.DragEvent<HTMLTableCellElement>) {
    e.preventDefault();
    const targetCell = e.currentTarget;
    const day = targetCell.dataset.day;
    const slot = targetCell.dataset.slot as SlotType;
    const room = targetCell.dataset.room;

    // Do not allow drag over on blocked UHC cells
    if (day && slot && room && isUHCBlocked(day, slot, room)) {
      e.dataTransfer.dropEffect = "none"; // Disallow drop
    } else {
      e.dataTransfer.dropEffect = "move"; // Allow drop
    }
  }

  /**
   * Adds 'drag-over' class when a draggable item enters a cell.
   * @param e - The React DragEvent.
   */
  function onDragEnterCell(e: React.DragEvent<HTMLTableCellElement>) {
    e.preventDefault();
    const targetCell = e.currentTarget;
    const day = targetCell.dataset.day;
    const slot = targetCell.dataset.slot as SlotType;
    const room = targetCell.dataset.room;

    // Only add drag-over class if not a blocked UHC cell
    if (day && slot && room && !isUHCBlocked(day, slot, room)) {
      e.currentTarget.classList.add("drag-over");
    }
  }

  /**
   * Removes 'drag-over' class when a draggable item leaves a cell.
   * @param e - The React DragEvent.
   */
  function onDragLeaveCell(e: React.DragEvent<HTMLTableCellElement>) {
    e.preventDefault();
    e.currentTarget.classList.remove("drag-over");
  }

  /**
   * Clears a therapist assignment from a specific slot.
   * @param day - The day of the slot.
   * @param slot - The time slot (AM/PM).
   * @param room - The room of the slot.
   */
  function clearSlot(day: string, slot: string, room: string) {
    setSchedule((prev) => {
      const newSchedule = JSON.parse(JSON.stringify(prev)) as SchedulerState;
      newSchedule[day][slot][room] = ""; // Set the slot to empty
      return newSchedule;
    });
  }

  /**
   * Saves the current schedule to localStorage and generates a sharable link.
   * The link is copied to the clipboard.
   */
  function saveSchedule() {
    const id = generateId(); // Generate a unique ID for this schedule instance
    try {
      localStorage.setItem(`schedule_${id}`, JSON.stringify(schedule)); // Save schedule to local storage
      const url = new URL(window.location.href);
      url.searchParams.set("id", id); // Add the ID to the URL parameters
      window.history.replaceState(null, "", url.toString()); // Update URL without reloading
      navigator.clipboard
        .writeText(url.toString()) // Copy the full URL to clipboard
        .then(() => setSavedMsg("Sharable link copied to clipboard!"))
        .catch(() => setSavedMsg("Schedule saved. Failed to copy link automatically."));
    } catch (error) {
      console.error("Failed to save schedule:", error);
      setSavedMsg("Error: Could not save schedule. LocalStorage might be full or disabled.");
    }
    setTimeout(() => setSavedMsg(""), 5000); // Clear message after 5 seconds
  }

  /**
   * Resets the entire schedule to an empty state and clears any associated ID from URL/localStorage.
   */
  function resetSchedule() {
    if (window.confirm("Are you sure you want to reset the entire schedule? This action cannot be undone.")) {
      setSchedule(normalizeSchedule({})); // Reset to an empty schedule
      const params = new URLSearchParams(window.location.search);
      const id = params.get("id");
      if (id) {
        localStorage.removeItem(`schedule_${id}`); // Remove saved schedule from local storage
        const url = new URL(window.location.href);
        url.searchParams.delete("id"); // Remove ID from URL
        window.history.replaceState(null, "", url.toString()); // Update URL without reloading
      }
      setSavedMsg("Schedule reset successfully!");
      setTimeout(() => setSavedMsg(""), 5000);
    }
  }

  /**
   * Handles changes to therapist availability rules (general availability, WFH, slots).
   * Uses useCallback for memoization to prevent unnecessary re-renders of child components.
   * @param therapistName - The name of the therapist whose rules are being changed.
   * @param type - The type of rule being changed ('day', 'wfh', 'slot').
   * @param value - The specific day or slot value.
   * @param isChecked - Boolean indicating if the checkbox is checked.
   */
  const handleAvailabilityChange = useCallback(
    (therapistName: string, type: "day" | "wfh" | "slot", value: string, isChecked: boolean) => {
      setTherapistRules((prevRules) => {
        const newRules = { ...prevRules };
        // Create a deep copy of the specific therapist's rules to ensure immutability
        const currentTherapistRules = { ...newRules[therapistName] };

        if (type === "day") {
          if (isChecked) {
            // Add day to availableDays, ensuring no duplicates and removing from WFH days
            currentTherapistRules.availableDays = Array.from(new Set([...currentTherapistRules.availableDays, value]));
            currentTherapistRules.wfhDays = currentTherapistRules.wfhDays.filter((d) => d !== value);
          } else {
            // Remove day from availableDays
            currentTherapistRules.availableDays = currentTherapistRules.availableDays.filter((d) => d !== value);
          }
        } else if (type === "wfh") {
          if (isChecked) {
            // Add day to wfhDays, ensuring no duplicates and removing from availableDays
            currentTherapistRules.wfhDays = Array.from(new Set([...currentTherapistRules.wfhDays, value]));
            currentTherapistRules.availableDays = currentTherapistRules.availableDays.filter((d) => d !== value);
          } else {
            // Remove day from wfhDays
            currentTherapistRules.wfhDays = currentTherapistRules.wfhDays.filter((d) => d !== value);
          }
        } else if (type === "slot") {
          if (isChecked) {
            // Add slot to availableSlots, ensuring no duplicates
            currentTherapistRules.availableSlots = Array.from(
              new Set([...currentTherapistRules.availableSlots, value as SlotType])
            );
          } else {
            // Remove slot from availableSlots
            currentTherapistRules.availableSlots = currentTherapistRules.availableSlots.filter((s) => s !== value);
          }
        }
        newRules[therapistName] = currentTherapistRules; // Assign back the modified copy
        return newRules;
      });
    },
    []
  ); // No dependencies, as it operates on prevRules

  /**
   * Handles changes to the maximum consecutive slots rule for a therapist.
   * Uses useCallback for memoization.
   * @param therapistName - The name of the therapist.
   * @param value - The selected value (1 or 2).
   */
  const handleMaxConsecutiveChange = useCallback((therapistName: string, value: string) => {
    setTherapistRules((prevRules) => ({
      ...prevRules,
      [therapistName]: {
        ...prevRules[therapistName],
        maxConsecutiveSlotsPerDay: parseInt(value, 10) as 1 | 2,
      },
    }));
  }, []); // No dependencies, as it operates on prevRules

  /**
   * Auto-generates the therapist roster based on defined rules.
   * This function clears the existing schedule and attempts to fill it
   * by prioritizing overall assignment balance and then room distribution.
   */
  const generateAutoRoster = () => {
    if (!window.confirm("Are you sure you want to auto-generate the roster? This will clear any existing assignments and apply rules.")) {
      return;
    }

    const newSchedule: SchedulerState = normalizeSchedule({}); // Start with a fresh, empty schedule

    // Track total assignments for each therapist for overall workload balance
    const therapistTotalAssignments: { [key: string]: number } = {};
    therapists.forEach((t) => (therapistTotalAssignments[t] = 0));

    // Track room assignments per therapist for room distribution fairness
    const therapistRoomUsage: { [therapist: string]: { [room: string]: number } } = {};
    therapists.forEach((t) => {
      therapistRoomUsage[t] = {};
      rooms.forEach((r) => (therapistRoomUsage[t][r] = 0));
    });

    /**
     * Helper function to check if a therapist can be assigned to a specific slot and room
     * based on all defined rules.
     * @param therapist - The therapist to check.
     * @param day - The day of the slot.
     * @param slot - The time slot (AM/PM).
     * @param room - The room of the slot.
     * @param currentDayAssignments - Tracks which slots (AM/PM) a therapist is already assigned to on the current day.
     * @returns True if the therapist can be assigned, false otherwise.
     */
    const canAssignTherapist = (
      therapist: string,
      day: string,
      slot: SlotType,
      room: string,
      currentDayAssignments: { [therapistName: string]: { AM: boolean; PM: boolean } }
    ): boolean => {
      const rules = therapistRules[therapist];

      // RULE: UHC room specific blocking
      // If the room is UHC, it's only allowed on Wed AM and Thu PM.
      if (room === "UHC") {
        const allowedWedAM = day === "Wed" && slot === "AM";
        const allowedThuPM = day === "Thu" && slot === "PM";
        if (!(allowedWedAM || allowedThuPM)) {
          return false; // Block UHC for other times
        }
      }

      // Rule 1: WFH Day Exclusion (Hard Constraint)
      // If the therapist is marked as WFH for this day, they cannot be assigned to a physical room.
      if (rules.wfhDays.includes(day)) {
        return false;
      }

      // Rule 2: General Day/Slot Availability (Hard Constraint)
      // If the therapist is not generally available for this day or this specific slot, they cannot be assigned.
      if (!rules.availableDays.includes(day) || !rules.availableSlots.includes(slot)) {
        return false;
      }

      // Rule 3: Max Consecutive Slots Per Day (Constraint)
      // If the therapist is limited to 1 slot per day, and they are already assigned to the other slot
      // on this day, they cannot take this current slot.
      if (rules.maxConsecutiveSlotsPerDay === 1) {
        const otherSlot = slot === "AM" ? "PM" : "AM";
        if (currentDayAssignments[therapist][otherSlot]) {
          return false;
        }
      }

      // Rule 4: Prevent multiple room assignments in the same AM/PM slot on the same day.
      // This is crucial to ensure a therapist isn't scheduled for e.g., Room A and Room B
      // simultaneously during the AM slot on the same Monday.
      if (currentDayAssignments[therapist][slot]) {
        return false;
      }

      return true; // If all checks pass, the therapist can be assigned
    };

    // Iterate through each day, then slot, then room to fill the schedule systematically
    for (const day of days) {
      // Initialize day-specific assignment tracking for consecutive slot rule.
      // This is reset for each new day.
      const dayAssignments: { [therapistName: string]: { AM: boolean; PM: boolean } } = {};
      therapists.forEach((t) => (dayAssignments[t] = { AM: false, PM: false }));

      for (const slot of slots) {
        for (const room of rooms) {
          const eligibleTherapists: { therapist: string; score: number }[] = [];

          // Loop through all therapists, starting from the last assigned one (round-robin)
          // to find eligible candidates for the current slot and room.
          for (let i = 0; i < therapists.length; i++) {
            const therapist = therapists[(lastAssignedIndex.current + i) % therapists.length];

            // Check if the current therapist can be assigned based on all rules
            if (canAssignTherapist(therapist, day, slot as SlotType, room, dayAssignments)) {
              // Calculate a score to prioritize selection: Lower score is better.
              // Primary priority: Fewer total assignments (overall workload balance).
              // Secondary priority: Fewer assignments to this specific room type (room distribution balance).
              const score = therapistTotalAssignments[therapist] * 1000 + therapistRoomUsage[therapist][room];
              eligibleTherapists.push({ therapist, score });
            }
          }

          if (eligibleTherapists.length > 0) {
            // Sort eligible therapists by their score to pick the "best" fit
            eligibleTherapists.sort((a, b) => a.score - b.score);

            const assignedTherapist = eligibleTherapists[0].therapist; // Pick the therapist with the lowest score

            // Assign the chosen therapist to the current slot and room in the new schedule
            newSchedule[day][slot][room] = assignedTherapist;

            // Update assignment counts for the assigned therapist
            therapistTotalAssignments[assignedTherapist]++;
            therapistRoomUsage[assignedTherapist][room]++;

            // Mark this slot (AM/PM) as taken for the assigned therapist on this specific day.
            // This is crucial for the 'maxConsecutiveSlotsPerDay' rule.
            dayAssignments[assignedTherapist][slot as SlotType] = true;

            // Update the global 'lastAssignedIndex' to continue the round-robin fairness
            // from this therapist for the next assignment attempt.
            lastAssignedIndex.current = therapists.indexOf(assignedTherapist);
          } else {
            // If no suitable therapist can be assigned based on the rules, leave the slot empty.
            newSchedule[day][slot][room] = "";
          }
        }
      }
    }
    setSchedule(newSchedule); // Update the main schedule state, which will trigger the counts recalculation
    setSavedMsg("Roster auto-generated successfully!");
    setTimeout(() => setSavedMsg(""), 5000); // Clear the success message after 5 seconds
  };
  // --- End Auto-Roster Function ---

  /**
   * Handles the PNG capture and download of the schedule table.
   */
  const saveScheduleAsPNG = async () => {
    if (scheduleTableRef.current) {
      setSavedMsg("Capturing schedule as image...");
      try {
        const canvas = await html2canvas(scheduleTableRef.current, {
          scale: 2, // Capture at 2x resolution for better clarity
          useCORS: true, // Set to true if you load images from external domains
          logging: false, // Set to true for debugging html2canvas issues
          backgroundColor: "#FFFFFF", // Ensure background is white if transparent issues occur
        });

        // Create an image URL from the canvas
        const image = canvas.toDataURL("image/png");

        // Create a temporary link element to trigger the download
        const link = document.createElement("a");
        link.href = image;
        // Dynamically name the file with current date and time
        const now = new Date();
        const fileName = `Therapist_Roster_${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${now.getDate().toString().padStart(2, "0")}_${now.getHours().toString().padStart(2, "0")}${now.getMinutes().toString().padStart(2, "0")}.png`;
        link.download = fileName;
        document.body.appendChild(link); // Append to body (required for Firefox)
        link.click(); // Programmatically click the link to trigger download
        document.body.removeChild(link); // Clean up the temporary link

        setSavedMsg("Schedule saved as PNG!");
      } catch (error) {
        console.error("Error saving schedule as PNG:", error);
        setSavedMsg("Error: Could not save schedule as PNG.");
      }
      setTimeout(() => setSavedMsg(""), 5000);
    } else {
      setSavedMsg("Error: Schedule table not found for PNG capture.");
      setTimeout(() => setSavedMsg(""), 5000);
    }
  };

  return (
    <div className={`container ${showRulesPanel ? "rules-panel-open" : ""}`}>
      {/* Rules Panel Overlay */}
      {showRulesPanel && <div className="rules-overlay" onClick={() => setShowRulesPanel(false)}></div>}

      <div className="header-content">
        <h1>Therapist Schedule</h1>
        <div className="current-time">{currentTime}</div>
      </div>

      <div className="view-controls">
        <button
          className={`view-btn ${viewType === "weekly" ? "active" : ""}`}
          onClick={() => setViewType("weekly")}
        >
          Weekly View
        </button>
        <button
          className={`view-btn ${viewType === "daily" ? "active" : ""}`}
          onClick={() => setViewType("daily")}
        >
          Daily View
        </button>

        {viewType === "daily" && (
          <div className="day-picker">
            {days.map((day) => (
              <button
                key={day}
                className={`day-btn ${selectedDay === day ? "active" : ""}`}
                onClick={() => setSelectedDay(day)}
              >
                {day}
              </button>
            ))}
          </div>
        )}

        <button className="generate-roster-btn" onClick={generateAutoRoster}>
          Generate Roster
        </button>

        <button className="rules-toggle-btn" onClick={() => setShowRulesPanel(!showRulesPanel)}>
          {showRulesPanel ? "Hide Rules" : "Show Rules"}
        </button>
      </div>

      <div className={`layout ${showRulesPanel ? "layout-shifted" : ""}`}>
        <div className="therapists-list">
          <h3>Therapists</h3>
          {therapists.map((therapist) => (
            <div
              key={therapist}
              className="therapist"
              draggable="true"
              onDragStart={(e) => onDragStartTherapist(e, therapist)}
            >
              {therapist}
            </div>
          ))}

          {/* Therapist Counts Panel - Now Collapsible */}
          <div className="therapist-counts-panel">
            <h3>
              Therapist Counts
              <button
                className={`toggle-collapse-btn ${isRoomOverviewCollapsed ? "collapsed" : ""}`}
                onClick={() => setIsRoomOverviewCollapsed(!isRoomOverviewCollapsed)}
                aria-expanded={!isRoomOverviewCollapsed}
                aria-controls="room-overview-content"
              >
                {/* A simple arrow or chevron icon */}
                {isRoomOverviewCollapsed ? "▶" : "▼"}
              </button>
            </h3>
            <div id="room-overview-content" className={`collapsible-content ${isRoomOverviewCollapsed ? "collapsed" : ""}`}>
              {Object.entries(therapistSlotCounts).map(([therapistName, counts]) => (
                <div key={therapistName} className="therapist-count-item">
                  <div className="therapist-summary">
                    <span className="therapist-name">{therapistName}</span>
                    <span className="total-slots">{counts.totalSlots} Slots</span>
                  </div>
                  <div className="room-breakdown">
                    {Object.entries(counts.roomDistribution)
                      .filter(([, count]) => count > 0) // Only show rooms with assignments
                      .map(([roomName, count]) => (
                        <span key={roomName} className="room-count">
                          {roomName}: {count}
                        </span>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="schedule-table-wrapper" ref={scheduleTableRef}>
          <table className={viewType === "weekly" ? "weekly-view-active" : ""}>
            <thead>
              <tr>
                {viewType === "weekly" ? (
                  <>
                    <th className="sticky-col-day">Day</th>
                    <th className="sticky-col-slot">Slot</th>
                  </>
                ) : (
                  <th className="sticky-col-day">Slot</th>
                )}
                {rooms.map((room) => (
                  <th key={room}>{room}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(viewType === "daily" ? [selectedDay] : days).map((day) => (
                <React.Fragment key={day}>
                  {slots.map((slot) => (
                    <tr key={`${day}-${slot}`}>
                      {viewType === "weekly" && (
                        <td className="sticky-col-day-cell">{day}</td>
                      )}
                      <td className="sticky-col-slot-cell">{slot}</td>
                      {rooms.map((room) => {
                        const assignedTherapist = schedule[day][slot][room];
                        const isBlocked = isUHCBlocked(day, slot, room);

                        return (
                          <td
                            key={`${day}-${slot}-${room}`}
                            className={`drop-cell ${isBlocked ? "blocked-uhc" : ""}`}
                            onDrop={(e) => onDropCell(e, day, slot, room)}
                            onDragOver={onDragOverCell}
                            onDragEnter={onDragEnterCell}
                            onDragLeave={onDragLeaveCell}
                            data-day={day} // Add data attributes for event handlers
                            data-slot={slot}
                            data-room={room}
                          >
                            {assignedTherapist ? (
                              <div
                                className="assigned-therapist"
                                draggable={isBlocked ? "false" : "true"} /* Can't drag into UHC, but can drag OUT if already assigned */
                                onDragStart={isBlocked ? undefined : (e) => onDragStartCell(e, assignedTherapist, day, slot, room)}
                                onDoubleClick={isBlocked ? undefined : () => clearSlot(day, slot, room)} // Double-click to clear
                              >
                                {assignedTherapist}
                                {/* Clear button (X) */}
                                <button
                                  className="assigned-therapist-clear-btn"
                                  onClick={() => clearSlot(day, slot, room)}
                                  title="Clear slot"
                                >
                                  &times;
                                </button>
                              </div>
                            ) : (
                              <span className="placeholder">Drag & Drop</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="button-group">
        <button className="save-png-btn" onClick={saveScheduleAsPNG}>
          Save as PNG
        </button>
        <button className="copy-btn" onClick={saveSchedule}>
          Save & Copy Link
        </button>
        <button className="reset-btn" onClick={resetSchedule}>
          Reset Schedule
        </button>
      </div>
      {savedMsg && (
        <div className={`saved-msg ${savedMsg.includes("Error") ? "error" : "success"}`}>
          {savedMsg}
        </div>
      )}

      {/* Rules Panel */}
      <div className={`rules-panel ${showRulesPanel ? "rules-panel-open" : ""}`}>
        <div className="rules-panel-header">
          <h2>Availability Rules</h2>
          <button className="close-panel-btn" onClick={() => setShowRulesPanel(false)}>
            &times;
          </button>
        </div>
        <p className="rules-hint">
          Configure general availability, Work-From-Home days, and max consecutive slots for each
          therapist. These rules are used by the "Generate Roster" function.
        </p>
        <div className="rules-scroll-area">
          {therapists.map((therapist) => (
            <div key={therapist} className="therapist-rules-card">
              <h3>{therapist}</h3>

              <div className="rule-section">
                <h4>Available Days (In-Office)</h4>
                <p className="rule-sub-hint">
                  Select days the therapist is generally available for office work.
                </p>
                <div className="checkbox-group">
                  {days.map((day) => (
                    <label key={day}>
                      <input
                        type="checkbox"
                        checked={therapistRules[therapist]?.availableDays?.includes(day) || false}
                        onChange={(e) =>
                          handleAvailabilityChange(therapist, "day", day, e.target.checked)
                        }
                      />
                      {day}
                    </label>
                  ))}
                </div>
              </div>

              <div className="rule-section">
                <h4>Work From Home (WFH) Days</h4>
                <p className="rule-sub-hint">
                  Therapists on WFH days will not be assigned to physical rooms. Overrides
                  "Available Days".
                </p>
                <div className="checkbox-group">
                  {days.map((day) => (
                    <label key={day}>
                      <input
                        type="checkbox"
                        checked={therapistRules[therapist]?.wfhDays?.includes(day) || false}
                        onChange={(e) =>
                          handleAvailabilityChange(therapist, "wfh", day, e.target.checked)
                        }
                      />
                      {day}
                    </label>
                  ))}
                </div>
              </div>

              <div className="rule-section">
                <h4>Available Slots</h4>
                <p className="rule-sub-hint">
                  Select morning (AM) or afternoon (PM) availability.
                </p>
                <div className="checkbox-group">
                  {slots.map((slot) => (
                    <label key={slot}>
                      <input
                        type="checkbox"
                        checked={therapistRules[therapist]?.availableSlots?.includes(slot) || false}
                        onChange={(e) =>
                          handleAvailabilityChange(therapist, "slot", slot, e.target.checked)
                        }
                      />
                      {slot}
                    </label>
                  ))}
                </div>
              </div>

              <div className="rule-section">
                <h4>Max Consecutive Slots Per Day</h4>
                <p className="rule-sub-hint">
                  Limit to 1 slot (AM or PM) or allow 2 (both AM & PM).
                </p>
                <div className="radio-group">
                  {[1, 2].map((num) => (
                    <label key={num}>
                      <input
                        type="radio"
                        name={`maxConsecutive-${therapist}`}
                        value={num}
                        checked={therapistRules[therapist]?.maxConsecutiveSlotsPerDay === num}
                        onChange={(e) =>
                          handleMaxConsecutiveChange(therapist, e.target.value)
                        }
                      />
                      {num}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}






