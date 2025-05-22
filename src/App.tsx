import React, { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";

const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const slots = ["AM", "PM"] as const; // 'as const' for stricter type inference
const rooms = [
  "Counselling Room A",
  "Counselling Room B",
  "Counselling Room C",
  "Counselling Room D",
];
const therapists = [
  "Dominic Yeo", "Kirsty Png", "Soon Jiaying", "Andrew Lim",
  "Janice Leong", "Oliver Tan", "Claudia Ahl", "Seanna Neo",
  "Xiao Hui", "Tika Zainal",
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
    wfhDays: string[];       // Days designated as Work From Home (cannot be assigned to a room)
    availableSlots: SlotType[];// Slots they are generally available (e.g., AM, PM)
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
  therapists.forEach(therapist => {
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
  const [schedule, setSchedule] = useState<SchedulerState>(() => normalizeSchedule({}));
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

  // State for therapist availability rules, loaded from localStorage or initialized
  const [therapistRules, setTherapistRules] = useState<TherapistAvailabilityRules>(() => {
    const savedRules = localStorage.getItem('therapist_rules');
    if (savedRules) {
      try {
        const parsedRules = JSON.parse(savedRules);
        // Ensure all therapists and new rule fields are present after parsing
        therapists.forEach(t => {
          if (!parsedRules[t]) {
            parsedRules[t] = initializeDefaultAvailability()[t];
          } else {
            // Initialize new rule fields if they were missing from older saved data
            if (parsedRules[t].wfhDays === undefined) parsedRules[t].wfhDays = [];
            if (parsedRules[t].maxConsecutiveSlotsPerDay === undefined) parsedRules[t].maxConsecutiveSlotsPerDay = 2;
            if (!Array.isArray(parsedRules[t].availableSlots)) { // Ensure it's an array
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
    localStorage.setItem('therapist_rules', JSON.stringify(therapistRules));
  }, [therapistRules]); // Dependency array: runs when therapistRules state changes

  /**
   * Effect to update and display the current date and time every second.
   */
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const options: Intl.DateTimeFormatOptions = {
        weekday: 'long', // e.g., 'Monday'
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false // 24-hour format
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
      therapists.forEach(t => {
        newCounts[t] = {
          totalSlots: 0,
          roomDistribution: {},
        };
        rooms.forEach(r => newCounts[t].roomDistribution[r] = 0);
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
    toSlot: string,
    toRoom: string
  ) {
    e.preventDefault();
    e.currentTarget.classList.remove("drag-over"); // Remove drag-over styling

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
    e.dataTransfer.dropEffect = "move";
  }

  /**
   * Adds 'drag-over' class when a draggable item enters a cell.
   * @param e - The React DragEvent.
   */
  function onDragEnterCell(e: React.DragEvent<HTMLTableCellElement>) {
    e.preventDefault();
    e.currentTarget.classList.add("drag-over");
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
  const handleAvailabilityChange = useCallback((
    therapistName: string,
    type: 'day' | 'wfh' | 'slot',
    value: string,
    isChecked: boolean
  ) => {
    setTherapistRules(prevRules => {
      const newRules = { ...prevRules };
      // Create a deep copy of the specific therapist's rules to ensure immutability
      const currentTherapistRules = { ...newRules[therapistName] };

      if (type === 'day') {
        if (isChecked) {
          // Add day to availableDays, ensuring no duplicates and removing from WFH days
          currentTherapistRules.availableDays = Array.from(new Set([...currentTherapistRules.availableDays, value]));
          currentTherapistRules.wfhDays = currentTherapistRules.wfhDays.filter(d => d !== value);
        } else {
          // Remove day from availableDays
          currentTherapistRules.availableDays = currentTherapistRules.availableDays.filter(d => d !== value);
        }
      } else if (type === 'wfh') {
        if (isChecked) {
          // Add day to wfhDays, ensuring no duplicates and removing from availableDays
          currentTherapistRules.wfhDays = Array.from(new Set([...currentTherapistRules.wfhDays, value]));
          currentTherapistRules.availableDays = currentTherapistRules.availableDays.filter(d => d !== value);
        } else {
          // Remove day from wfhDays
          currentTherapistRules.wfhDays = currentTherapistRules.wfhDays.filter(d => d !== value);
        }
      } else if (type === 'slot') {
        if (isChecked) {
          // Add slot to availableSlots, ensuring no duplicates
          currentTherapistRules.availableSlots = Array.from(new Set([...currentTherapistRules.availableSlots, value as SlotType]));
        } else {
          // Remove slot from availableSlots
          currentTherapistRules.availableSlots = currentTherapistRules.availableSlots.filter(s => s !== value);
        }
      }
      newRules[therapistName] = currentTherapistRules; // Assign back the modified copy
      return newRules;
    });
  }, []); // No dependencies, as it operates on prevRules

  /**
   * Handles changes to the maximum consecutive slots rule for a therapist.
   * Uses useCallback for memoization.
   * @param therapistName - The name of the therapist.
   * @param value - The selected value (1 or 2).
   */
  const handleMaxConsecutiveChange = useCallback((therapistName: string, value: string) => {
    setTherapistRules(prevRules => ({
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
    therapists.forEach(t => therapistTotalAssignments[t] = 0);

    // Track room assignments per therapist for room distribution fairness
    const therapistRoomUsage: { [therapist: string]: { [room: string]: number } } = {};
    therapists.forEach(t => {
      therapistRoomUsage[t] = {};
      rooms.forEach(r => therapistRoomUsage[t][r] = 0);
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
      currentDayAssignments: { [therapistName: string]: { AM: boolean, PM: boolean } }
    ): boolean => {
      const rules = therapistRules[therapist];

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
        const otherSlot = slot === 'AM' ? 'PM' : 'AM';
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
      const dayAssignments: { [therapistName: string]: { AM: boolean, PM: boolean } } = {};
      therapists.forEach(t => dayAssignments[t] = { AM: false, PM: false });

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
   * Helper function to get an abbreviated room name (e.g., "Counselling Room A" -> "Rm A").
   * @param fullRoomName - The full name of the room.
   * @returns The abbreviated room name.
   */
  const getAbbreviatedRoomName = (fullRoomName: string): string => {
    return fullRoomName.replace("Counselling ", "");
  };

  return (
    <div className={`container ${showRulesPanel ? 'rules-panel-open' : ''}`}>
        {/* Overlay for when the rules panel is open, to dim background and allow closing on click */}
        {showRulesPanel && <div className="rules-overlay" onClick={() => setShowRulesPanel(false)}></div>}

      <div className="header-content">
        <h1>Therapist Room Allocation</h1>
        <div className="current-time">{currentTime}</div>
      </div>

      <div className="view-controls">
        {/* Buttons to switch between Weekly and Daily views */}
        <button
          className={`view-btn ${viewType === "weekly" ? "active" : ""}`}
          onClick={() => setViewType("weekly")}
        >
          Weekly View
        </button>
        <button
          className={`view-btn ${viewType === "daily" ? "active" : ""}`}
          onClick={() => {
            setViewType("daily");
            // Ensure selectedDay is valid if it changes (e.g., if a day was removed)
            setSelectedDay(prevDay => days.includes(prevDay) ? prevDay : days[0]);
          }}
        >
          Daily View
        </button>
        {/* Day picker buttons, only visible in Daily View */}
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
        {/* Button to trigger auto-roster generation */}
        <button className="generate-roster-btn" onClick={generateAutoRoster}>
            Auto-Generate Roster
        </button>
        {/* Button to toggle the rules customization panel */}
        <button className="rules-toggle-btn" onClick={() => setShowRulesPanel(true)}>
            Customise Rules
        </button>
      </div>

      {/* Main layout containing therapist list and schedule table */}
      <div className="layout">
        {/* Therapist list and assignments overview panel */}
        <div className="therapists-list">
          <h3>Therapists</h3>
          {therapists.map((t) => (
            <div
              key={t}
              draggable
              onDragStart={(e) => onDragStartTherapist(e, t)}
              className="therapist"
              title={`Drag ${t} to assign`}
            >
              {t}
            </div>
          ))}

          {/* Therapist Slot Counts Panel */}
          <div className="therapist-counts-panel">
            <h3>Room Overview</h3>
            {therapists.map(t => {
                const currentTherapistCounts = therapistSlotCounts[t];
                // Find the maximum room assignment for *this specific therapist*
                // This helps in calculating the percentage width for bar charts if implemented.
                // For this textual display, it's not directly used but good for context.
                // If no assignments, default to 1 to prevent division by zero.
                const maxAssignmentsForThisTherapist = currentTherapistCounts
                    ? Math.max(...Object.values(currentTherapistCounts.roomDistribution))
                    : 1;

                return (
                    <div key={`count-${t}`} className="therapist-count-item">
                        <div className="therapist-summary">
                            <span className="therapist-name">{t}</span>
                            <span className="total-slots">{currentTherapistCounts?.totalSlots || 0} slots</span>
                        </div>
                        <div className="room-breakdown">
                            {rooms.map(room => (
                                <span key={`count-${t}-${room}`} className="room-count">
                                    {getAbbreviatedRoomName(room)}: {currentTherapistCounts?.roomDistribution[room] || 0}
                                </span>
                            ))}
                        </div>
                    </div>
                );
            })}
          </div>
        </div>

        {/* Schedule Table Wrapper */}
        <div className="schedule-table-wrapper">
          <table>
            <thead>
              {viewType === "weekly" ? (
                // Weekly View Header: Day | Slot | Room A | Room B | ...
                <tr>
                  <th className="sticky-col-day">Day</th>
                  <th className="sticky-col-slot">Slot</th>
                  {rooms.map((room) => (
                    <th key={room}>
                      <small>{getAbbreviatedRoomName(room)}</small>
                    </th>
                  ))}
                </tr>
              ) : (
                // Daily View Header: Slot | Day (spanning rooms) | Room A | Room B | ...
                <>
                  <tr>
                    <th rowSpan={2} style={{ verticalAlign: 'middle' }}>Slot</th>
                    <th key={selectedDay} colSpan={rooms.length} style={{ textAlign: 'center' }}>
                      {selectedDay}
                    </th>
                  </tr>
                  <tr>
                    {rooms.map((room) => (
                      <th key={`${selectedDay}-${room}`}>
                        <small>{getAbbreviatedRoomName(room)}</small>
                      </th>
                    ))}
                  </tr>
                </>
              )}
            </thead>
            <tbody>
              {viewType === "weekly" ? (
                // Weekly View Body: Each row is a Day-Slot combination
                days.flatMap((day, dayIndex) =>
                  slots.map((slot, slotIndex) => (
                    <tr key={`${day}-${slot}`}>
                      {/* Day cell, spans two rows (AM/PM) */}
                      {slotIndex === 0 && (
                        <td rowSpan={slots.length} className="sticky-col-day-cell">
                          {day}
                        </td>
                      )}
                      {/* Slot cell (AM or PM) */}
                      <td className="sticky-col-slot-cell">{slot}</td>
                      {/* Room cells for the current day and slot */}
                      {rooms.map((room) => {
                        const currentTherapist = schedule[day]?.[slot]?.[room];
                        return (
                          <td
                            key={`${day}-${slot}-${room}`}
                            onDrop={(e) => onDropCell(e, day, slot, room)}
                            onDragOver={onDragOverCell}
                            onDragEnter={onDragEnterCell}
                            onDragLeave={onDragLeaveCell}
                            className="drop-cell"
                          >
                            {currentTherapist ? (
                              <div
                                className="assigned-therapist"
                                draggable
                                onDragStart={(e) => onDragStartCell(e, currentTherapist, day, slot, room)}
                                title={`Drag to move ${currentTherapist}. Click X to clear.`}
                              >
                                {currentTherapist}
                                <button
                                  className="clear-slot-btn"
                                  onClick={() => clearSlot(day, slot, room)}
                                  title="Clear slot"
                                >
                                  &times;
                                </button>
                              </div>
                            ) : (
                              <span className="placeholder"></span> // Empty placeholder for empty cells
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )
              ) : (
                // Daily View Body: Each row is a slot for the selected day
                slots.map((slot) => (
                  <tr key={slot}>
                    <td>{slot}</td>
                    {rooms.map((room) => {
                      const currentTherapist = schedule[selectedDay]?.[slot]?.[room];
                      return (
                        <td
                          key={`${selectedDay}-${slot}-${room}`}
                          onDrop={(e) => onDropCell(e, selectedDay, slot, room)}
                          onDragOver={onDragOverCell}
                          onDragEnter={onDragEnterCell}
                          onDragLeave={onDragLeaveCell}
                          className="drop-cell"
                        >
                          {currentTherapist ? (
                            <div
                              className="assigned-therapist"
                              draggable
                              onDragStart={(e) => onDragStartCell(e, currentTherapist, selectedDay, slot, room)}
                              title={`Drag to move ${currentTherapist}. Click X to clear.`}
                            >
                              {currentTherapist}
                              <button
                                className="clear-slot-btn"
                                onClick={() => clearSlot(selectedDay, slot, room)}
                                title="Clear slot"
                              >
                                &times;
                              </button>
                            </div>
                          ) : (
                            <span className="placeholder"></span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {/* Action buttons for schedule management */}
          <div className="button-group">
            <button className="reset-btn" onClick={resetSchedule}>
              Reset Schedule
            </button>
            <button className="copy-btn" onClick={saveSchedule}>
              Save & Copy Sharable Link
            </button>
          </div>
          {/* Message display for save/error feedback */}
          {savedMsg && <p className={`saved-msg ${savedMsg.startsWith("Error") ? 'error' : ''}`}>{savedMsg}</p>}
        </div>
      </div>

      {/* Rules Panel - positioned fixed to slide in from the right */}
      <div className={`rules-panel ${showRulesPanel ? 'rules-panel-open' : ''}`}>
        <div className="rules-panel-header">
            <h2>Therapist Roster Rules</h2>
            <button className="close-panel-btn" onClick={() => setShowRulesPanel(false)}>&times;</button>
        </div>
        <p className="rules-hint">
            Define rules for each therapist. The auto-roster will attempt to fill the schedule based on these constraints, prioritising an equal distribution of assignments and rooms.
        </p>
        <div className="rules-scroll-area">
          {therapists.map(therapist => (
            <div key={therapist} className="therapist-rules-card">
              <h3>{therapist}</h3>
              <div className="rule-section">
                <h4>General Availability:</h4>
                <p className="rule-sub-hint">Days and slots they are available for any office work.</p>
                <div className="checkbox-group">
                  {days.map(day => (
                    <label key={`avail-${therapist}-${day}`}>
                      <input
                        type="checkbox"
                        checked={therapistRules[therapist]?.availableDays.includes(day)}
                        onChange={(e) => handleAvailabilityChange(therapist, 'day', day, e.target.checked)}
                      />
                      {day}
                    </label>
                  ))}
                </div>
                <div className="checkbox-group">
                  {slots.map(slot => (
                    <label key={`avail-${therapist}-${slot}`}>
                      <input
                        type="checkbox"
                        checked={therapistRules[therapist]?.availableSlots.includes(slot)}
                        onChange={(e) => handleAvailabilityChange(therapist, 'slot', slot, e.target.checked)}
                      />
                      {slot}
                    </label>
                  ))}
                </div>
              </div>

              <div className="rule-section">
                <h4>Work From Home (WFH) Days:</h4>
                <p className="rule-sub-hint">Therapists cannot be assigned to rooms on these days.</p>
                <div className="checkbox-group">
                  {days.map(day => (
                    <label key={`wfh-${therapist}-${day}`}>
                      <input
                        type="checkbox"
                        checked={therapistRules[therapist]?.wfhDays.includes(day)}
                        onChange={(e) => handleAvailabilityChange(therapist, 'wfh', day, e.target.checked)}
                      />
                      {day}
                    </label>
                  ))}
                </div>
              </div>

              <div className="rule-section">
                <h4>Max Consecutive Slots (Per Day):</h4>
                <p className="rule-sub-hint">Set to 1 if they can only do AM *or* PM. Set to 2 if they can do both AM & PM.</p>
                <div className="radio-group">
                  <label>
                    <input
                      type="radio"
                      name={`consecutive-${therapist}`}
                      value="1"
                      checked={therapistRules[therapist]?.maxConsecutiveSlotsPerDay === 1}
                      onChange={(e) => handleMaxConsecutiveChange(therapist, e.target.value)}
                    />
                    1 slot (AM or PM)
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={`consecutive-${therapist}`}
                      value="2"
                      checked={therapistRules[therapist]?.maxConsecutiveSlotsPerDay === 2}
                      onChange={(e) => handleMaxConsecutiveChange(therapist, e.target.value)}
                    />
                    2 slots (AM & PM)
                  </label>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}







