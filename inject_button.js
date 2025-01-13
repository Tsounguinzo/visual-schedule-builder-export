// -----------------------------------------------------
// 1) SETUP CLICK OUTSIDE LOGIC
// -----------------------------------------------------
function setupClickOutsideToClose(popupElement, buttonElement, onClose) {
	// Keep the handler reference so we can remove/re-add if desired
	const handleClickOutside = (event) => {
		const isOutside = !popupElement.contains(event.target) && event.target !== buttonElement;
		const isVisible = popupElement.style.display === 'block';
		if (isOutside && isVisible) {
			onClose();
		}
	};


	// Register once, don’t remove
	document.addEventListener('click', handleClickOutside);
}

// -----------------------------------------------------
// 2) HANDLE POPUP SHOW/HIDE
// -----------------------------------------------------
let isPopupOpen = false;
let isExported = false;
const popupWindow = document.createElement('div');
const exportBtn = document.createElement('button');
stylePopupElement(popupWindow); // helper to add your styles

async function togglePopup() {
	if (!isPopupOpen) {
		let holidaySchedules = {};
		try {
			const currentTermId = getCurrentTermId();
			if (!currentTermId) {
				throw new Error('No term ID found.');
			}
			const termBundleData = await fetchTermBundle(currentTermId);
			holidaySchedules = termBundleData.holidayschedules || {};
		} catch (error) {
			console.error('Error fetching term bundle:', error);
			// Continue without holiday data if fetch fails.
		}
		showPopup(holidaySchedules);
	} else {
		hidePopup();
	}
}

function showPopup(holidaySchedules) {
	isPopupOpen = true;
	positionPopupBelowButton(exportBtn, popupWindow); // Position popup relative to the button
	popupWindow.style.display = 'block';

	if (!isExported) {
		popupWindow.innerHTML = `
      <h3 style="text-align:center;border-bottom:2px solid #912338">Ready To Export!</h3>
      <br>
      <p>Note: This extension currently does not account for breaks, such as reading week or holidays.</p>
    `;

		// Build up events from DOM
		let events = extractEventsFromSchedule();
		events = removeDuplicateEvents(events);

		// "Go" button
		const goBtn = document.createElement('button');
		goBtn.textContent = 'Go!';
		goBtn.className = 'big_button'
		goBtn.style.width = '100%';
		goBtn.addEventListener('click', (event) => {
			event.stopPropagation();
			popupWindow.innerHTML = `
                <div style="text-align: center;">
                    <p>Exporting...</p>
                    <div class="spinner"></div>
                </div>
            `;
			addSpinnerStyle();

			// Convert each to a GCal event object
			const calendarEvents = [];
			for (const e of events) {
				const gcEvent = createEvent(e, holidaySchedules);
				if (gcEvent) calendarEvents.push(gcEvent);
			}
			exportToGoogleCalendar(calendarEvents);
		});

		popupWindow.appendChild(goBtn);
		document.body.appendChild(popupWindow);
	} else {
		popupWindow.innerHTML = 'Calendar exported.';
	}
}

function hidePopup() {
	isPopupOpen = false;
	popupWindow.style.display = 'none';
}

// -----------------------------------------------------
// 3) CREATE & INSERT BUTTON
// -----------------------------------------------------
function createExportButton() {
	exportBtn.className = 'mdl-button mdl-button--raised mdl-button--accent';
	exportBtn.textContent = 'Export';
	exportBtn.addEventListener('click', togglePopup);

	// Insert before last child of parent
	const parent = document.getElementsByClassName('main_menu_button')[0].parentNode;
	parent.insertBefore(exportBtn, parent.lastElementChild);

	setupClickOutsideToClose(popupWindow, exportBtn, hidePopup);
}

createExportButton();

// -----------------------------------------------------
// 4) EXTRACT EVENTS & MATCH UP INFO
// -----------------------------------------------------
function extractEventsFromSchedule() {
	const events = [];

	// 1) Gather from .time_block
	const courseContainer = document.querySelector('.weekTimes');
	if (!courseContainer) return events;
	const timeBlocks = courseContainer.getElementsByClassName('time_block');

	for (const block of timeBlocks) {
		const nodeList = block.querySelector('.nonmobile')?.childNodes || [];
		if (nodeList.length >= 3) {
			events.push({
				courseName: '',
				courseCode: nodeList[0].textContent.trim(),
				component: nodeList[2].textContent.trim(),
				time: [],
				days: '',
				location: '',
				start: null,
				end: null,
			});
		}
	}

	// 2) Build courseInfoMap
	const courseBoxes = document.getElementById('legend_box')?.getElementsByClassName('course_box') || [];
	const courseInfoMap = buildCourseInfoMap(courseBoxes);

	// 3) Match them
	matchEventsToCourseInfo(events, courseInfoMap);

	return events;
}

function buildCourseInfoMap(courseBoxes) {
	const map = {};
	for (const box of courseBoxes) {
		const base = box.querySelector('.legend_table .tr .td');
		if (!base) continue;

		// Grab the .course_header .header_cell childNodes
		const courseHeader = base.querySelector('.course_header .header_cell')?.childNodes;
		if (!courseHeader || courseHeader.length < 6) continue;

		const courseCode = courseHeader[0].textContent.trim();
		const courseDuration = parseDate(courseHeader[1].childNodes);
		const session = courseHeader[2].textContent.trim();
		const courseName = courseHeader[3].childNodes[1]?.textContent.trim() || '';
		const dayTimeData = parseDayTime(courseHeader[5].childNodes);

		const vsbSelection = base.querySelector('.vsbselectionnew');
		const componentsPlusLocation = extractContent(vsbSelection);

		map[courseCode] = {
			courseName,
			session,
			courseDuration,     // { start: Date, end: Date }
			courseDayTime: dayTimeData,
			componentsPlusLocation
		};
	}
	return map;
}

function matchEventsToCourseInfo(events, courseInfoMap) {
	for (const event of events) {
		const courseData = courseInfoMap[event.courseCode];
		if (!courseData) return; // No info for this code

		event.courseName = courseData.courseName;

		// Ensure matching is done in order
		const orderedComponents = courseData.componentsPlusLocation;

		// Identify components present in events for this courseCode
		const eventComponents = events
			.filter(e => e.courseCode === event.courseCode)
			.map(e => e.component);

		// Bring courseDayTime to the same length as componentsPlusLocation
		let courseDayTime = JSON.parse(JSON.stringify(courseData.courseDayTime));
		const adjustedCourseDayTime = Array(orderedComponents.length).fill(null);
		orderedComponents.forEach((component, index) => {
			if (eventComponents.some(comp => component.type.startsWith(comp))) {
				adjustedCourseDayTime[index] = courseDayTime.shift() || null;
			}
		});

		// Find the matching component in componentsPlusLocation
		const componentIndex = orderedComponents.findIndex(c =>
			c.type.startsWith(event.component)
		);

		if (componentIndex !== -1) {
			// Match the corresponding dayTime in the same order
			const matchingDayTime = adjustedCourseDayTime[componentIndex];

			if (matchingDayTime) {
				// Assign details from componentsPlusLocation
				const matchingComponent = orderedComponents[componentIndex];
				event.location = matchingComponent.location || '';

				// Assign details from courseDayTime
				event.time = [matchingDayTime.startTime, matchingDayTime.endTime];
				event.days = matchingDayTime.days.join(", ");
				event.start = courseData.courseDuration.start;
				event.end = courseData.courseDuration.end;
			}
		} else {
			console.warn(`No matching component for: ${event.courseCode} ${event.component}`);
		}
	}
}

function removeDuplicateEvents(events) {
	return events.filter(
		(ev, idx, arr) =>
			idx === arr.findIndex(
				(t) => t.courseCode === ev.courseCode && t.component === ev.component
			)
	);
}

// -----------------------------------------------------
// 5) CREATE CALENDAR EVENT & EXPORT
// -----------------------------------------------------
function createEvent(event, holidaySchedules) {
	// Validate event.start
	if (!(event.start instanceof Date) || isNaN(event.start)) {
		console.warn('Invalid or missing event start date:', event);
		return null;
	}

	// Convert times to 24-hour
	const start24 = convertTo24Hour(event.time[0]);
	const end24   = convertTo24Hour(event.time[1]);

	// Create new dates for the actual start/end times
	const startDateTime = new Date(
		event.start.getFullYear(),
		event.start.getMonth(),
		event.start.getDate(),
		start24.hours,
		start24.minutes
	);

	const endDateTime = new Date(
		event.start.getFullYear(),
		event.start.getMonth(),
		event.start.getDate(),
		end24.hours,
		end24.minutes
	);

	const untilDateTime = new Date(
		event.end.getFullYear(),
		event.end.getMonth(),
		event.end.getDate(),
		end24.hours,
		end24.minutes
	);

	// Adjust date offsets if needed (Mon/Tue/Wed, etc.)
	const daysArray = event.days.split(',').map(d => d.trim());
	shiftDatesByWeekday(startDateTime, endDateTime, daysArray[0]);

	// Generate an exclusion list for holidays
	const exclusions = generateHolidayExclusions(holidaySchedules, startDateTime, untilDateTime);

	// Calculate the last day (UNTIL in RRULE)
	const untilStr   = formatUntilDate(untilDateTime);

	const byDayStr = toByDay(daysArray);
	const colorId = getColorIdForCourse(event.courseCode);

	return {
		kind: 'calendar#event',
		summary: `${event.courseCode} ${event.component}`,
		location: event.location,
		start: {
			dateTime: formatLocalDateTime(startDateTime),
			timeZone: 'America/Toronto',
		},
		end: {
			dateTime: formatLocalDateTime(endDateTime),
			timeZone: 'America/Toronto',
		},
		recurrence: [
			`RRULE:FREQ=WEEKLY;UNTIL=${untilStr};BYDAY=${byDayStr}`,
			...exclusions
		],
		colorId
	};
}

function exportToGoogleCalendar(eventArray) {

	if (!eventArray || !Array.isArray(eventArray) || eventArray.length === 0) {
		popupWindow.innerHTML = 'No events to export.';
		return;
	}

	// Skip createEvent if events are already in the correct format
	const eventsToExport = eventArray.map(event => {
		if (event.kind === 'calendar#event') {
			return event;
		}
		return createEvent(event);
	}).filter(event => event !== null);

	if (eventsToExport.length === 0) {
		popupWindow.innerHTML = 'No valid events to export.';
		return;
	}

	chrome.runtime.sendMessage(eventsToExport, function(response) {
		if (response && response.success) {
			popupWindow.innerHTML = `Successfully exported ${response.created} of ${response.total} events.`;
			isExported = true;
		} else if (response) {
			popupWindow.innerHTML = `Error: Only ${response.created || 0} of ${response.total || 0} events were exported.`;
		} else {
			popupWindow.innerHTML = 'Error: No response received from the server.';
		}
	});

}

// -----------------------------------------------------
// 6) HELPER FUNCTIONS
// -----------------------------------------------------
const courseColors = {};
const usedColors = new Set('11');

function parseDate(rawDates) {
	if (!rawDates || rawDates.length < 2) {
		return { start: null, end: null };
	}
	const yearMatch       = rawDates[0].textContent.match(/\b\d{4}\b/);
	const dateRangeMatch  = rawDates[1].textContent.match(/(\w{3} \d{1,2}) - (\w{3} \d{1,2})/);
	if (!yearMatch || !dateRangeMatch) {
		return { start: null, end: null };
	}

	const yearText      = yearMatch[0];
	const startDateText = dateRangeMatch[1];
	const endDateText   = dateRangeMatch[2];

	const startDate = new Date(`${startDateText}, ${yearText}`);
	const endDate   = new Date(`${endDateText}, ${yearText}`);
	return { start: startDate, end: endDate };
}

function parseDayTime(dayTimeNodes) {
	return Array.from(dayTimeNodes)
		.filter(node => node.nodeType === Node.TEXT_NODE && node.nodeValue.trim())
		.map(textNode => textNode.nodeValue.trim())
		.map(segment => {
			const match = segment.match(/^([\w,\s]+)\s*:\s*([\d:APM\s]+)\s+to\s+([\d:APM\s]+)$/);
			if (!match) return null;

			const [ , dayStr, startTime, endTime ] = match;
			const days = dayStr.split(',').map(d => d.trim());

			return { days, startTime, endTime, raw: segment };
		})
		.filter(Boolean);
}

function extractContent(component) {
	if (!component) return [];

	const detailsTable = component.querySelector('.selection_row .selection_table .inner_legend_table');
	if (!detailsTable || !detailsTable.childNodes[0]) return [];

	const detailsRows = detailsTable.childNodes[0].childNodes;
	if (!detailsRows) return [];

	const filteredRows = Array.from(detailsRows).filter(row => {
		return row.tagName === 'TR' && row.querySelector('td[align="right"]');
	});

	return filteredRows.map(row => {
		const typeBlock = row.querySelector('.type_block')?.textContent.trim() || '';
		const method    = row.querySelector('.instructional_method_block')?.textContent.trim() || '';
		const location  = row.querySelector('.location_block')?.textContent.trim() || '';
		return { type: typeBlock, instructionalMethod: method, location };
	});
}

function formatLocalDateTime(date) {
	// e.g. returns "2025-01-14T17:45:00"
	const yyyy = date.getFullYear();
	const mm   = String(date.getMonth() + 1).padStart(2, '0');
	const dd   = String(date.getDate()).padStart(2, '0');
	const hh   = String(date.getHours()).padStart(2, '0');
	const min  = String(date.getMinutes()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}T${hh}:${min}:00`;
}

function convertTo24Hour(timeStr) {
	if (!timeStr) return { hours: 0, minutes: 0 };

	const [rawTime, ampm] = timeStr.split(/\s+/);
	const [rawHours, rawMinutes] = rawTime.split(':');

	let hours = parseInt(rawHours, 10);
	const minutes = parseInt(rawMinutes, 10);

	if (ampm?.toUpperCase() === 'PM' && hours < 12) hours += 12;
	if (ampm?.toUpperCase() === 'AM' && hours === 12) hours = 0;

	return { hours, minutes };
}

function shiftDatesByWeekday(start, end, firstDay) {
	const dayToOffset = {
		'Mon': 0, 'Tue': 1, 'Wed': 2, 'Thu': 3, 'Fri': 4
	};
	const offset = dayToOffset[firstDay] || 0;
	start.setDate(start.getDate() + offset);
	end.setDate(end.getDate() + offset);
}

function getColorIdForCourse(courseCode) {
	const maxColors = 11; // Google Calendar supports colorIds 1–11
	if (courseColors[courseCode]) {
		return courseColors[courseCode];
	}

	let colorId;
	do {
		colorId = (Math.floor(Math.random() * maxColors) + 1).toString(); // Generate a random colorId
	} while (usedColors.has(colorId)); // Ensure no duplicate colors

	courseColors[courseCode] = colorId;
	usedColors.add(colorId);

	return colorId;
}

function formatUntilDate(date) {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}${m}${d}`; // YYYYMMDD
}

function formatExdate(date) {
	const yyyy = date.getFullYear();
	const mm = String(date.getMonth() + 1).padStart(2, '0');
	const dd = String(date.getDate()).padStart(2, '0');
	const hh = String(date.getHours()).padStart(2, '0');
	const min = String(date.getMinutes()).padStart(2, '0');
	const ss = String(date.getSeconds()).padStart(2, '0');
	return `${yyyy}${mm}${dd}T${hh}${min}${ss}`;
}


function toByDay(dayArr) {
	const dayMap = { Mon: 'MO', Tue: 'TU', Wed: 'WE', Thu: 'TH', Fri: 'FR' };
	return dayArr.map(d => dayMap[d] || '').filter(Boolean).join(',');
}

// Just a style helper
function stylePopupElement(elem) {
	elem.style.display = 'none';
	elem.style.position = 'absolute';
	elem.style.top = '45px';
	elem.style.right = '0px';
	elem.style.zIndex = '9999';
	elem.style.minWidth = '200px';
	elem.style.padding = '16px';
	elem.style.background = '#fff';
	elem.style.border = '1px solid #ddd';
	elem.style.borderRadius = '2px';
	elem.style.boxShadow =
		'0 2px 2px 0 rgba(0, 0, 0, .14), ' +
		'0 3px 1px -2px rgba(0, 0, 0, .2), ' +
		'0 1px 5px 0 rgba(0, 0, 0, .12)';
}

function positionPopupBelowButton(buttonElement, popupElement) {
	const buttonRect = buttonElement.getBoundingClientRect();
	popupElement.style.top = `${window.scrollY + buttonRect.bottom + 5}px`; // Below the button
}

function addSpinnerStyle() {
	const style = document.createElement('style');
	style.textContent = `
        .spinner {
            width: 30px;
            height: 30px;
            margin: 10px auto;
            border: 4px solid #f3f3f3;
            border-radius: 50%;
            border-top: 4px solid #912338;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
	document.head.appendChild(style);
}

function getCurrentTermId() {
	const activeMenuItem = document.querySelector('a.menu_item.select_term .fa-check[style]');
	if (activeMenuItem) {
		const onclickAttr = activeMenuItem.parentElement.getAttribute('onclick');
		const termIdMatch = onclickAttr.match(/UU\.caseChangeTermIfOkay\((\d+)\)/);
		return termIdMatch ? termIdMatch[1] : null;
	}
	return null;
}

function generateHolidayExclusions(holidaySchedules, startDate, endDate, timeZone = 'America/Toronto') {
	const exclusions = [];
	const scheduleKeys = Object.keys(holidaySchedules);

	// Loop through all the days between startDate and endDate
	const currentDate = new Date(startDate);
	while (currentDate <= endDate) {
		const dayCode = getDayCode(currentDate);

		for (const scheduleKey of scheduleKeys) {
			if (isHoliday(scheduleKey, dayCode, holidaySchedules)) {
				exclusions.push(formatExdate(currentDate));
				break;
			}
		}

		// Move to the next day
		currentDate.setDate(currentDate.getDate() + 1);
	}

	// Return exclusions formatted for RRULE
	return exclusions.map(date => `EXDATE;TZID=${timeZone}:${date}`);
}

function isHoliday(scheduleKey, dayCode, holidaySchedules) {
	const sched = holidaySchedules[scheduleKey];
	return sched && sched.holidays && sched.holidays[dayCode] ? true : false;
}

async function fetchTermBundle(termId) {
	const response = await fetch(`https://vsb.concordia.ca/api/v2/classextras/termbundle?term=${termId}`);
	if (!response.ok) {
		throw new Error('Network response was not ok');
	}
	return response.json();
}

function getDayCode(date) {
	if (!(date instanceof Date)) {
		throw new Error("Input must be a Date object.");
	}

	// Calculate the number of milliseconds since December 31, 2007
	const referenceDate = new Date(2007, 11, 31);
	const timeDifference = date.getTime() - referenceDate.getTime();

	return Math.ceil(timeDifference / (1000 * 60 * 60 * 24));
}