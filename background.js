chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

	// 1. Validate the incoming request
	if (!request || !Array.isArray(request)) {
		console.error("Invalid request format");
		sendResponse({
			success: false,
			error: "Invalid request format"
		});
		return true;
	}

	// 2. Get the OAuth token from Chrome
	chrome.identity.getAuthToken({ interactive: true }, async (token) => {
		if (chrome.runtime.lastError) {
			console.error("Auth error:", chrome.runtime.lastError);
			sendResponse({
				success: false,
				error: `Authentication error: ${chrome.runtime.lastError.message}`
			});
			return;
		}

		if (!token) {
			console.error("No token received");
			sendResponse({ success: false, error: "No authentication token received" });
			return;
		}

		console.log("Successfully got auth token:", token);

		// 3. Loop through each event and create it on Google Calendar
		const url = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
		let completedRequests = 0;
		let successfulRequests = 0;

		for (let i = 0; i < request.length; i++) {
			const eventObj = request[i];
			try {
				const response = await fetch(url, {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${token}`,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify(eventObj)
				});

				if (!response.ok) {
					const errorBody = await response.text();
					throw new Error(
						`HTTP error! status: ${response.status}, body: ${errorBody}`
					);
				}

				const data = await response.json();
				console.log(`Event ${i} created successfully:`, data);
				successfulRequests++;
			} catch (error) {
				console.error(`Failed to create event ${i}:`, error);
			} finally {
				completedRequests++;
			}
		}

		// 4. Send final response back to the content script
		sendResponse({
			success: successfulRequests > 0,
			created: successfulRequests,
			total: request.length
		});

		// Optionally, open Google Calendar if at least one was successfully created
		if (successfulRequests > 0) {
			chrome.tabs.create({ url: "https://calendar.google.com" });
		}
	});

	return true;
});