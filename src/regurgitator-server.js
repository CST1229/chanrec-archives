import fs from "node:fs/promises";
import db from "./sqlitedb.js";

export const types = db
	.prepare(`SELECT type FROM regurgitatorTypes ORDER BY type ASC;`)
	.pluck()
	.all();

const regurgitatorHTML = (filterHTML) => `
	<div style="display: none" id="generateForm">
		<div>
			<label for="type">Username:</label>
			<select name="type" id="type">
				${types.map(
					t =>
						`<option${t === "chanrec" ? " selected" : ""}>${t}</option>`
				)}
			</select>
		</div>
		<div>
			<label for="num">Number of messages:</label>
			<input name="num" id="num" type="number" min="1" max="100" step="1" value="1"></input>
		</div>
		<div><button id="generateButton">Generate</button></div>
	</form>

	<p id="results"><noscript>You need JavaScript enabled to use the message generator!</noscript></p>
	<div id="output"></div>
	<script type="module">
		const formEl = document.getElementById("generateForm");
		formEl.setAttribute("style", "");
		
		const typeEl = document.getElementById("type");
		const numEl = document.getElementById("num");
		const resultEl = document.getElementById("results");
		const outputEl = document.getElementById("output");

		let generating = false;
		let words = null;

		async function doGen() {
			const num = +numEl.value || 1;
			const type = typeEl.value;

			outputEl.innerHTML = "";

			if (!words) {
				resultEl.textContent = "Downloading words...";
				try {
					words = await (await fetch("./regurgitator-words.json", {mode: "cors"})).json();
				} catch(e) {
					resultEl.textContent = "Could not download words. " + e.toString();
					console.error(e);
					return;
				}
			}
			resultEl.textContent = "Generating...";
			await new Promise(res => setTimeout(res, 1));
			
			function pickRandom(arr) {
				return arr[Math.floor(Math.random() * arr.length)];
			}

			function getWord(current, user) {
				return pickRandom(words[current + "S" + user] || [current === "ERROR" ? "<END>" : "ERROR"]);
			}

			function createMessage(user) {
				const words = [];
				let current = "<START>";
				while (true) {
					current = getWord(current, user);
					if (current === undefined || current === null) {
						return null;
					}
					if (current === "<END>") {
						break;
					}
					words.push(current);
					if (current.length > 300) break;
				}
				return \`<\$\{user}> \` + words.join(" ");
			}
			
			const filterHTML = ${filterHTML.toString()};

			let generated = "";
			let i = num;
			while (i >= 1) {
				generated += createMessage(type) || "(Could not generate message.)";
				generated += "\\n";
				i--;
			}
			generated = generated.trim();

			outputEl.innerHTML = "<pre><code>" + filterHTML(generated) + "</code></pre>";
			resultEl.textContent = "";
		}

		document.getElementById("generateButton").onclick = function(e) {
			e.preventDefault();
			if (generating) return;
			generating = true;
			doGen().then(() => generating = false).catch(e => {
				generating = false;
				resultEl.textContent = "Could not generate words. " + e.toString();
				console.error(e);
			})
		}
	</script>
`;

export default function doServer(wrapSite, root, filterHTML) {
	const regurgitatorDB = db.prepare(`SELECT * FROM regurgitator`).all();
	const words = {};
	for (const e of regurgitatorDB) {
		const key = e.current + "S" + e.type;
		words[key] ||= [];
		words[key].push(e.next);
	}
	fs.writeFile(root + "regurgitator-words.json", JSON.stringify(words));

	if (types && types.length) {
		fs.writeFile(root + "generator.html",
			wrapSite(
				regurgitatorHTML(filterHTML),
				"Message Generator"
			)
		);
	} else {
		fs.writeFile(root + "generator.html",
			wrapSite(
				`
			The generator hasn't been generated yet (<code>npm run generateRegurg</code>).
		`,
				"Message Generator"
			)
		);
	}
}
