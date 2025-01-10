chrome.runtime.onMessage.addListener(
	function(request, sender, sendResponse) {
		console.log("Received request:", request);

		if (!request || !Array.isArray(request)) {
			console.error("Invalid request format");
			sendResponse({success: false, error: "Invalid request format"});
			return true;
		}

		// Try to get the auth token with more detailed error handling
		chrome.identity.getAuthToken(
			{
				'interactive': true
			},
			function(token) {
				if (chrome.runtime.lastError) {
					console.error('Auth error:', chrome.runtime.lastError);
					sendResponse({
						success: false,
						error: `Authentication error: ${chrome.runtime.lastError.message}`
					});
					return;
				}

				if (!token) {
					console.error('No token received');
					sendResponse({success: false, error: "No authentication token received"});
					return;
				}

				console.log("Successfully got auth token");

				// code for creating events...
				const url = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
				let completedRequests = 0;
				let successfulRequests = 0;

				request.forEach((event, index) => {
					fetch(url, {
						method: 'POST',
						headers: {
							'Authorization': `Bearer ${token}`,
							'Content-Type': 'application/json',
						},
						body: JSON.stringify(event)
					})
						.then(response => {
							if (!response.ok) {
								return response.text().then(text => {
									throw new Error(`HTTP error! status: ${response.status}, body: ${text}`);
								});
							}
							return response.json();
						})
						.then(data => {
							console.log(`Event ${index} created successfully:`, data);
							successfulRequests++;
						})
						.catch(error => {
							console.error(`Failed to create event ${index}:`, error);
						})
						.finally(() => {
							completedRequests++;
							if (completedRequests === request.length) {
								sendResponse({
									success: successfulRequests > 0,
									created: successfulRequests,
									total: request.length
								});

								if (successfulRequests > 0) {
									chrome.tabs.create({ url: "https://calendar.google.com" });
								}
							}
						});
				});
			}
		);

		return true;
	}
);