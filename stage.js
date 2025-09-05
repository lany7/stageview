console.log("📜 Script loaded");

const ENABLE_DEDUPLICATION = true;      // Set to false to disable deduplication
const SHOW_VERSE_AND_CHORUS = true;     // Set to false to only show selected tag


let lastSlideKey = null;

// Debounce helper to avoid rapid fetches
let debounceTimer;
function debounceFetchLiveSlideText() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fetchLiveSlideText, 100);
}

function scaleTextToFit(element) {
  console.log("🔠 Scaling text...");

  let fontSize = 10; // starting size in vw
  element.style.fontSize = fontSize + "vw";

  const fits = () => (
    element.scrollWidth <= window.innerWidth &&
    element.scrollHeight <= window.innerHeight
  );

  let min = 0.5;
  let max = 10;

  while (max - min > 0.1) {
    fontSize = (min + max) / 2;
    element.style.fontSize = fontSize + "vw";

    if (fits()) {
      min = fontSize;
    } else {
      max = fontSize;
    }
  }

  element.style.fontSize = min + "vw";
  console.log(`✅ Final font size: ${min.toFixed(2)}vw`);
}

function collapseIdenticalSlides(slideArr) {
  if (!ENABLE_DEDUPLICATION) {
    // No deduplication, just return all htmls
    return slideArr.map(s => s.html || "");
  }
  // ...existing deduplication logic...
  const result = [];
  let prev = null;
  for (let i = 0; i < slideArr.length; i++) {
    const curr = slideArr[i];
    const currHtml = curr.html || "";
    if (prev && (currHtml === prev.html)) {
      if (result.length === 0 || !result[result.length - 1].startsWith("//:")) {
        result[result.length - 1] = `//: ${currHtml} ://`;
      }
    } else {
      result.push(currHtml);
    }
    prev = curr;
  }
  return result;
}

async function updateContent(slide) {
  console.log("updateContent called with:", slide);
  const slideContent = document.getElementById("slide-content");
  const stageTitle = document.getElementById("stage-title");

  // Only show title if slide.name contains "song" (case-insensitive)
  if (slide.name && slide.name.toLowerCase().includes("song")) {
    stageTitle.textContent = slide.title || "";
  } else {
    stageTitle.textContent = "";
  }

  // Always clear if blank/theme is set (from websocket)
  if (slide._blank === true || slide._theme === true) {
    // Always clear, regardless of lastSlideKey
    while (slideContent.firstChild) {
      slideContent.removeChild(slideContent.firstChild);
    }
    lastSlideKey = null; // Reset so next real slide will show
    return;
  }

  // Only do lastSlideKey logic for real slides
  const slideKey = slide.img ?? slide.html ?? slide.text ?? "";
  if (slideKey === lastSlideKey) return;
  lastSlideKey = slideKey;

  while (slideContent.firstChild) {
    slideContent.removeChild(slideContent.firstChild);
  }

  if (slide.img) {
    let imgSrc = slide.img;
    try {
      const url = `http://${location.hostname}:4316/api/v2/core/live-image`;
      const res = await fetch(url, { method: "GET" });
      const data = await res.json();
      if (data.binary_image) imgSrc = data.binary_image;
    } catch (err) {
      console.error("❌ High-res image fetch failed:", err);
    }
    const img = document.createElement("img");
    img.src = imgSrc;
    img.alt = slide.title || "Image";
    img.setAttribute("data-slide-img", Date.now());
    Object.assign(img.style, {
      maxWidth: "100vw",
      maxHeight: "100vh",
      display: "block",
      margin: "0 auto"
    });
    slideContent.appendChild(img);
    return;
  }

  const clean = (slide.html ?? slide.text ?? "")
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+>/gi, '');
  slideContent.textContent = clean;
  scaleTextToFit(slideContent);
}

function groupSlidesByTag(slides, tag) {
  return slides.filter(s => s.tag === tag).map(s => s.html || "").join("<br>");
}

function fetchLiveSlideText() {
  const baseUrl = `http://${location.hostname}:4316/api/v2/controller/live-items`;
  fetch(baseUrl)
    .then(res => res.json())
    .then(data => {
      const slides = data.slides || [];
      const topLevelName = data.name || "";

      if (!slides.length) {
        updateContent({ text: "(no slides)", title: "", name: topLevelName });
      }

      const selected = slides.find(s => s.selected);
      if (!selected) {
        updateContent({ text: "(no content)", title: "", name: topLevelName });
        return;
      }

      if (selected.img) {
        updateContent({ ...selected, title: selected.title || "", name: topLevelName });
        return;
      }

      if (selected.tag) {
        const tag = selected.tag;

        if (SHOW_VERSE_AND_CHORUS) {

          // If the selected is a verse (e.g., V1), also find the next refrain (e.g., R1)
          if (/^V\d+/i.test(tag)) {
            // Find the first and last index of this verse
            let firstVerseIdx = -1, lastVerseIdx = -1;
            for (let i = 0; i < slides.length; i++) {
              if (slides[i].tag === tag) {
                if (firstVerseIdx === -1) firstVerseIdx = i;
                lastVerseIdx = i;
              }
            }
            // Collect all verse slides
            const verseSlides = slides.slice(firstVerseIdx, lastVerseIdx + 1);
            const verseHtml = collapseIdenticalSlides(verseSlides).join("<br>");

            // Find the next chorus tag after the verse
            let chorusTag = null, chorusStart = -1, chorusEnd = -1;
            for (let i = lastVerseIdx + 1; i < slides.length; i++) {
              if (/^R\d+/i.test(slides[i].tag)) {
                chorusTag = slides[i].tag;
                chorusStart = i;
                // Find the end of this chorus segment (before next verse or end)
                chorusEnd = i;
                for (let j = i + 1; j < slides.length; j++) {
                  if (/^V\d+/i.test(slides[j].tag)) break;
                  if (slides[j].tag === chorusTag) chorusEnd = j;
                }
                break;
              }
              if (/^V\d+/i.test(slides[i].tag)) break;
            }
            let chorusHtml = "";
            if (chorusStart !== -1 && chorusEnd !== -1) {
              const chorusSlides = slides.slice(chorusStart, chorusEnd + 1);
              chorusHtml = collapseIdenticalSlides(chorusSlides).join("<br>");
            }

            if (chorusHtml) {
              updateContent({ html: verseHtml + "<br>" + chorusHtml, title: selected.title || "", name: topLevelName }); 
              return;
            } else {
              updateContent({ html: verseHtml, title: selected.title || "", name: topLevelName });
              return;
            }
          }

          // If the selected is a refrain (e.g., R1), also find the previous verse (e.g., V1)
          if (/^R\d+/i.test(tag)) {
            // Find the index of the first selected chorus slide
            const selectedIdx = slides.findIndex(s => s === selected);

            // Find the start and end of this chorus segment
            let chorusTag = tag;
            let chorusStart = selectedIdx, chorusEnd = selectedIdx;
            // Expand backwards
            for (let i = selectedIdx - 1; i >= 0; i--) {
              if (slides[i].tag === chorusTag) chorusStart = i;
              else break;
            }
            // Expand forwards
            for (let i = selectedIdx + 1; i < slides.length; i++) {
              if (slides[i].tag === chorusTag) chorusEnd = i;
              else break;
            }
            const chorusSlides = slides.slice(chorusStart, chorusEnd + 1);
            const chorusHtml = collapseIdenticalSlides(chorusSlides).join("<br>");

            // Find the previous verse segment
            let verseTag = null, verseStart = -1, verseEnd = -1;
            for (let i = chorusStart - 1; i >= 0; i--) {
              if (/^V\d+/i.test(slides[i].tag)) {
                verseTag = slides[i].tag;
                // Find the start of this verse segment
                verseEnd = i;
                verseStart = i;
                for (let j = i - 1; j >= 0; j--) {
                  if (slides[j].tag === verseTag) verseStart = j;
                  else break;
                }
                break;
              }
            }
            let verseHtml = "";
            if (verseStart !== -1 && verseEnd !== -1) {
              const verseSlides = slides.slice(verseStart, verseEnd + 1);
              verseHtml = collapseIdenticalSlides(verseSlides).join("<br>");
            }

            if (verseHtml) {
              updateContent({ html: verseHtml + "<br>" + chorusHtml, title: selected.title || "", name: topLevelName });
              return;
            } else {
              updateContent({ html: chorusHtml, title: selected.title || "", name: topLevelName });
              return;
            }
          }
          // Default: group by tag
          const tagSlides = slides.filter(s => s.tag === tag);
          const verseHtml = collapseIdenticalSlides(tagSlides).join("<br>");
          updateContent({ html: verseHtml, title: selected.title || "", name: topLevelName });
          return;
        }
      }

      updateContent({ ...selected, title: selected.title || "", name: topLevelName });
    })
    .catch(err => {
      console.error("❌ Fetch failed:", err);
      updateContent({ text: "(error fetching live verse)", title: "" });
    });
}

const socket = new WebSocket(`ws://${location.hostname}:4317/api/ws`);
socket.onopen = () => {
  console.log("WebSocket opened");
};
socket.onmessage = (event) => {
  console.log("RAW WebSocket message event:", event);
  console.log("RAW WebSocket message data:", event.data);

  // If event.data is a Blob, read it as text first
  if (event.data instanceof Blob) {
    const reader = new FileReader();
    reader.onload = function() {
      try {
        const data = JSON.parse(reader.result);
        const results = data.results || {};
        if (results.blank === true || results.theme === true) {
          updateContent({ _blank: results.blank, _theme: results.theme });
        } else {
          debounceFetchLiveSlideText();
        }
      } catch (e) {
        console.error("WebSocket message parse error (blob):", e);
        debounceFetchLiveSlideText();
      }
    };
    reader.readAsText(event.data);
    return;
  }

  // If event.data is a string, parse directly
  try {
    const data = JSON.parse(event.data);
    const results = data.results || {};
    if (results.blank === true || results.theme === true) {
      updateContent({ _blank: results.blank, _theme: results.theme });
    } else {
      debounceFetchLiveSlideText();
    }
  } catch (e) {
    console.error("WebSocket message parse error:", e);
    debounceFetchLiveSlideText();
  }
};
socket.onerror = (err) => {
  console.error("WebSocket error:", err);
};
socket.onclose = (evt) => {
  console.warn("WebSocket closed:", evt);
};

const fullscreenBtn = document.getElementById("fullscreen-btn");

document.addEventListener("fullscreenchange", function() {
  if (document.fullscreenElement) {
    fullscreenBtn.style.display = "none";
  } else {
    fullscreenBtn.style.display = "";
  }
});

document.getElementById("fullscreen-btn").onclick = function() {
  const elem = document.documentElement;
  if (!document.fullscreenElement) {
    if (elem.requestFullscreen) elem.requestFullscreen();
    else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
    else if (elem.msRequestFullscreen) elem.msRequestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    else if (document.msExitFullscreen) document.msExitFullscreen();
  }
};