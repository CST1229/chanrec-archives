// This contains most of the bot's source code.
// I should split this into several files one day...

import fs from "node:fs/promises";

import db from "./sqlitedb.js";

import doRegurgitator, {
	types as regurgTypes,
} from "./regurgitator-server.js";
const hasGenerator = regurgTypes && regurgTypes.length;

// Uncomment this to disable the bot
// return;

const root = "./dist/";

await fs.rm(root + "*", {recursive: true, force: true});
await fs.mkdir(root, { recursive: true });
await fs.cp("./src/static", root, { recursive: true });
await fs.copyFile("db/database.sqlite", root + "database.sqlite");


const getCurrentTranscript = db.prepare(`
	SELECT * FROM transcripts WHERE current = 1;
`);

function addCurrentTranscript() {
	const start = Date.now();
	db.prepare(
		`INSERT INTO transcripts
			(id, name, text, start, current)
			VALUES (@id, 'Current transcript', '', @start, 1)`
	).run({
		id: start.toString(),
		start,
	});
}

let transcript, transcriptName, okCount, transcriptStart, transcriptEdited;
let transcriptDirty = false;
function refreshCurrentTranscript() {
	const currentTranscript = getCurrentTranscript.get();
	transcript = currentTranscript.text;
	transcriptName = currentTranscript.name;
	okCount = currentTranscript.okCount;
	transcriptStart = currentTranscript.start;
	transcriptEdited = !!currentTranscript.edited;
	transcriptDirty = false;
}

if (!getCurrentTranscript.get()) {
	addCurrentTranscript();
}
refreshCurrentTranscript();

let totalOks = db
	.prepare(`SELECT total(okCount) FROM transcripts`)
	.pluck()
	.get();

function filterHTML(txt) {
	if (!txt) {
		return "";
	}

	let parsedValue = txt;
	parsedValue = parsedValue.replaceAll("&", "&amp;");
	parsedValue = parsedValue.replaceAll("<", "&lt;");
	parsedValue = parsedValue.replaceAll(">", "&gt;");
	parsedValue = parsedValue.replaceAll('"', "&quot;");
	parsedValue = parsedValue.replaceAll("'", "&apos;");
	return parsedValue;
}

function getSize(bytes) {
	let val = bytes;
	let unit = "";
	if (bytes < 1000) {
		unit = " bytes";
	} else if (bytes < 1000000) {
		val /= 1000;
		unit = "KB";
	} else {
		val /= 1000000;
		unit = "MB";
	}
	return `${Math.round(val * 100) / 100}${unit}`;
}

///// SERVER /////

const wrapSite = function (html, title = null, dotdot = 0) {
	const rt = "./" + "../".repeat(dotdot);
	const generatorLink = hasGenerator
		? `<a href="${rt}generator.html">Generator</a> -`
		: "";
	return (
		`<!DOCTYPE html>
	<html>
		<head>
			<link rel="stylesheet" href="${rt}assets/style.css" />
			<title>${title ? title + " - ChanRec Archives" : "ChanRec Archives"}</title>
		</head>
		<body>
		<h1>${title ? title : "ChanRec Archives"}</h1>
		<div id="navbar">
			<a href="${rt}index.html">Home</a> -
			<a href="${rt}help.html">Commands</a> -
			${generatorLink}
			<a href="${rt}transcripts.html">Transcripts</a> -
			<a href="${rt}database.sqlite">Download Database</a>
			<form id="search" action="${rt}search.html" method="get">
				<input type="search" placeholder="Search" name="q">
				<button>Go!</button>
			</form>
		</div>
` +
		html +
		`</body>
	</html>`
	);
};

const editedWm =
	'<span class="transcript-edited">(this transcript was edited)</span>';

function filterTranscript(transcript) {
	return filterHTML(transcript)
		.split("\n")
		.map(
			(v, i) =>
				`<div id="l${(
					i + 1
				).toString()}" class="tl">${v}<a href="#l${(
					i + 1
				).toString()}" class="ln">${(
					i + 1
				).toString()}</a></div>`
		)
		.join("\n");
}

function transcriptHTML(o, hasText = true) {
	const start = new Date(o.start).toLocaleString("en-US", {
		timeZone: "UTC",
		hour12: false,
	});
	let end;
	if (o.end)
		end = new Date(o.end).toLocaleString("en-US", {
			timeZone: "UTC",
			hour12: false,
		});

	return `
	<h2>${filterHTML(o.name)}</h2>
	<b>Started at:</b> ${start}<br />
	${end ? `<b>Ended at:</b> ${end}<br />` : ""}
	<b>ID:</b> ${filterHTML(o.id)}<br />
	<b>OK count:</b> ${o.okCount.toString()}<br />
	<b>Size:</b> ${getSize(o.text.length)}
	${o.edited ? "<br />" + editedWm : ""}<br /><br />
	<button 
		onclick="navigator.clipboard.writeText(document.getElementById('transcript').textContent);"
	>
		Copy Transcript
	</button>
	<button 
		onclick="navigator.clipboard.writeText('[code]\\n'+document.getElementById('transcript').textContent+'[/code]');"
	>
		Copy BBCode
	</button>
	${hasText
			? `<br /><pre><code id="transcript">${o.lost
				? "This transcript was lost."
				: filterTranscript(o.text)
			}</code></pre>`
			: ""
		}
	`;
}

fs.writeFile(root + "index.html", wrapSite(`
	<b>Total OK count:</b> ${totalOks.toString()}<br />
	
	${transcriptHTML({
	name: transcriptName,
	id: transcriptStart.toString(),
	text: transcript,
	start: transcriptStart,
	edited: transcriptEdited,
	okCount,
	lost: 0,
})}`)
);

const transcripts = [];
{
	let html = "";
	const archives = db
		.prepare(
			`SELECT id, name, start, lost
			FROM transcripts WHERE current = 0
			ORDER BY start DESC`
		)
		.all();

	if (archives.length === 0) {
		html += `No archived transcripts.`;
	} else {
		html += `<ul>`;
		for (const o of archives) {
			const start = new Date(o.start).toLocaleString("en-US", {
				timeZone: "UTC",
				hour12: false,
			});

			html += `<li>
				${o.lost ? "<del>" : ""}<a href="./transcripts/${filterHTML(o.id)}.html">${filterHTML(
				o.name
			)}</a> (${start})${o.lost ? "</del>" : ""}
			</li>`;
			transcripts.push(o.id);
		}
		html += `</ul>`;
	}

	fs.writeFile(root + "transcripts.html", wrapSite(`${html}`, "Transcripts"));
};

const getTranscript = db.prepare(`SELECT * FROM transcripts WHERE id = ?`);
await fs.mkdir(root + "transcripts/", {recursive: true});
for (const idToFind of transcripts) {
	const o = getTranscript.get(idToFind);
	fs.writeFile(root + "transcripts/" + idToFind + ".html", wrapSite(`${transcriptHTML(o)}`, "View Transcript", 1));
};

fs.writeFile(root + "help.html", (
	wrapSite(
		`<p>The commands that existed back when the original ChanRec was online.</p>
	<h2>Logging</h2>
	<ul>
		<li><code>!enable</code> - Allow your messages to be logged.</li>
		<li><code>!disable</code> - Prevent your messages from being logged.</li>
		<li><code>!enabled</code> - Check if the bot logs your messages or not.</li>
		<li><code>!split</code> - Splits the transcript and moves it into <a href="./transcripts.html">the archives</a>.</li>
		<li><code>!repeat (lines)</code> - Repeats some part of the current transcript. Has a somewhat complex syntax; for more details run <code>!repeat</code>.</li>
		<li><code>= (message)</code> - Not really a command. Prevents this message from being responded to or logged by ChanRec, even if you are not in the ignore list.</li>
	</ul>
	<h2>Fun</h2>
	<ul>
		<li><code>!message (text)</code> - Says the previous !message.</li>
		<li><code>!ok</code> - Get the number of times someone said OK. Also viewable through the transcript page.</li>
		<!-- <li><code>!oklock</code> - Toggles OK lock (sends OK count when someone says OK). Only works in channels.</li> -->
		<li><code>!generate (user)</code> - Generates a nonexistent message from a user. See also the <a href="./generator.html">Message Generator</a>.</li>
	</ul>
	<h2>Operator Only</h2>
	<ul>
		<li><code>!say</code> - Makes the bot say something. Only works in channels.</li>
		<li><code>!leave</code> - Stops the bot.</li>
		<li><code>!rawsend</code> - Makes the bot send a raw IRC message to the server.</li>
		<li><code>!edit (optional: id)</code> - Sends a link in DMs to edit a transcript.</li>
		<li><code>!clear</code> - Clears the transcript and transcript archives.</li>
	</ul>
	<h2>Other</h2>
	<ul>
		<li><code>!regain</code> - Runs <code>/ns REGAIN</code>, making the bot regain its nickname (e.g ChanRec1 -> ChanRec).</li>
		<li><code>!help</code> (or <code>HELP</code> in DMs) - Send the links to the transcript and this page.</li>
	</ul>`,
		"Commands"
	)
));

{
	// this is a really inefficient way to do it but eh
	const archives = db.prepare(`SELECT * FROM transcripts`).all();
	fs.writeFile(root + "archives-search.json", JSON.stringify(archives.map(o => ({
		n: o.name.toLowerCase(),
		t: (o.text || "").toLowerCase(),
		i: o.id,
		s: o.start,
	}))));

	const js = `
	const resultEl = document.getElementById("results");
	resultEl.textContent = "Downloading search index...";
	try {
		const archives = await (await fetch("./archives-search.json", {mode: "cors"})).json();
	} catch(e) {
		resultEl.textContent = "Could not download search index. " + e.toString();
	 	console.error(e);
		return;
	}
	resultEl.textContent = "Searching...";

	const q = (new URLSearchParams(location.search)).get("q") || "";

	const filterHTML = ${filterHTML.toString()};

	let results = [];
	for (const o of archives) {
		const occurrences =
			o.n.split(q).length - 1 +
			o.t.split(q).length - 1;
		if (occurrences > 0) {
			results.push(Object.assign(o, { occurrences }));
		}
	}

	const sort = function (arr) {
		const newArr = [{ occurrences: Infinity }];
		for (const item of arr) {
			for (const i in newArr) {
				const item2 = newArr[i];
				if (item.occurrences <= item2.occurrences) {
					newArr.splice(i, 0, item);
					break;
				}
			}
		}
		newArr.pop();
		return newArr.reverse();
	};
	results = sort(results);

	let html = "";
	const l = results.length;
	const resultsText = \`(\${l.toString()} result\${l === 1 ? "" : "s"})\`;

	html += \`<h2>\${filterHTML(q)} \${resultsText}</h2>\`;
	if (results.length === 0) {
		html += \`<p>No results found.</p>\`;
	} else {
		html += \`<ul>\`;
		for (const o of results) {
			const occurrences = \`\${o.occurrences.toString()} occurrence\${o.occurrences === 1 ? "" : "s"
				}\`;
			if (!o.current) {
				const start = new Date(o.s).toLocaleString("en-US", {
					timeZone: "UTC",
					hour12: false,
				});
				const id = o.i.toString();
				html += \`<li>
					<a href="./transcripts/\${filterHTML(id)}.html">\${filterHTML(
					o.n
				)}</a> (\${start}; \${occurrences})
				</li>\`;
			} else {
				const start = new Date(${transcriptStart}).toLocaleString(
					"en-US",
					{ timeZone: "UTC", hour12: false }
				);
				html += \`<li>
					<a href="./index.html">${transcriptName}</a> (current transcript) (\${start}; \${occurrences})
				</li>\`;
			}
		}
		html += \`</ul>\`;
	}
	resultEl.innerHTML = html;
`;
	fs.writeFile(root + "search.html", wrapSite(`
		<div id="results">
			<noscript>You need JavaScript enabled to search!</noscript>
		</div>
		<script type="module">${js}</script>
`, "Search Results"));
}

doRegurgitator(wrapSite, root, filterHTML);

console.log("Wrote files to " + root);