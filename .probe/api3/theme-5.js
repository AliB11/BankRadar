if (typeof listAudio !== 'undefined') {
    function createTrackItem(e) {
        var t = document.createElement("div");
        t.setAttribute("class", "playlist-track-ctn"), t.setAttribute("id", "ptc-" + e), t.setAttribute("data-index", e), document.querySelector(".playlist-ctn").appendChild(t);
        var i = document.createElement("div");
        i.setAttribute("class", "playlist-btn-play"), i.setAttribute("id", "pbp-" + e), document.querySelector("#ptc-" + e).appendChild(i);
        var r = document.createElement("i");
        r.setAttribute("class", "fas fa-play"), r.setAttribute("height", "40"), r.setAttribute("width", "40"), r.setAttribute("id", "p-img-" + e), document.querySelector("#pbp-" + e).appendChild(r)
    }

    for (var i = 0; i < listAudio.length; i++) createTrackItem(i, listAudio[i].name, listAudio[i].duration);
    var indexAudio = 0;

    function loadNewTrack(e) {
        document.querySelector("#source-audio").src = listAudio[e].file, document.querySelector(".signal-podcast-player__title").innerHTML = listAudio[indexAudio].desc, document.querySelector(".signal-podcast-player__desc").innerHTML = listAudio[indexAudio].title, document.querySelector(".signal-podcast-player__reporter").innerHTML = listAudio[indexAudio].reporter, document.querySelector(".signal-podcast-player__img").src = listAudio[indexAudio].img, this.currentAudio = document.getElementById("myAudio"), this.currentAudio.load(), this.toggleAudio(), this.updateStylePlaylist(this.indexAudio, e), this.indexAudio = e
    }

    var playListItems = document.querySelectorAll(".playlist-track-ctn");
    for (let e = 0; e < playListItems.length; e++) playListItems[e].addEventListener("click", getClickedElement.bind(this));

    function getClickedElement(e) {
        for (let i = 0; i < playListItems.length; i++) if (playListItems[i] == e.target) {
            var t = e.target.getAttribute("data-index");
            t == this.indexAudio ? this.toggleAudio() : loadNewTrack(t)
        }
    }

    document.querySelector("#source-audio").src = listAudio[indexAudio].file, document.querySelector(".signal-podcast-player__title").innerHTML = listAudio[indexAudio].desc, document.querySelector(".signal-podcast-player__desc").innerHTML = listAudio[indexAudio].title, document.querySelector(".signal-podcast-player__reporter").innerHTML += listAudio[indexAudio].reporter, document.querySelector(".signal-podcast-player__img").src = listAudio[indexAudio].img;
    var interval1, currentAudio = document.getElementById("myAudio");

    function toggleAudio() {
        this.currentAudio.paused ? (document.querySelector("#icon-play").style.display = "none", document.querySelector("#icon-pause").style.display = "block", document.querySelector("#ptc-" + this.indexAudio).classList.add("active-track"), this.playToPause(this.indexAudio), this.currentAudio.play()) : (document.querySelector("#icon-play").style.display = "block", document.querySelector("#icon-pause").style.display = "none", this.pauseToPlay(this.indexAudio), this.currentAudio.pause())
    }

    function pauseAudio() {
        this.currentAudio.pause(), clearInterval(interval1)
    }

    currentAudio.load(), currentAudio.onloadedmetadata = function () {
        document.getElementsByClassName("duration")[0].innerHTML = this.getMinutes(this.currentAudio.duration)
    }.bind(this);
    var timer = document.getElementsByClassName("timer")[0], barProgress = document.getElementById("myBar"), width = 0;

    function onTimeUpdate() {
        var e = this.currentAudio.currentTime;
        if (timer.innerHTML = this.getMinutes(e), this.setBarProgress(), this.currentAudio.ended && (document.querySelector("#icon-play").style.display = "block", document.querySelector("#icon-pause").style.display = "none", this.pauseToPlay(this.indexAudio), this.indexAudio < listAudio.length - 1)) {
            var t = parseInt(this.indexAudio) + 1;
            this.loadNewTrack(t)
        }
    }

    function setBarProgress() {
        var e = this.currentAudio.currentTime / this.currentAudio.duration * 100;
        document.getElementById("myBar").style.width = e + "%"
    }

    function getMinutes(e) {
        var t = parseInt(parseInt(e) / 60), i = parseInt(e % 60);
        return i < 10 && (i = "0" + i), t < 10 && (t = "0" + t), t + ":" + i
    }

    var progressbar = document.querySelector("#myProgress");

    function seek(e) {
        var t = e.offsetX / progressbar.offsetWidth;
        this.currentAudio.currentTime = t * this.currentAudio.duration, barProgress.style.width = 100 * t + "%"
    }

    function forward() {
        this.currentAudio.currentTime = this.currentAudio.currentTime + 30, this.setBarProgress()
    }

    function rewind() {
        this.currentAudio.currentTime = this.currentAudio.currentTime - 30, this.setBarProgress()
    }

    function next() {
        if (this.indexAudio < listAudio.length - 1) {
            var e = this.indexAudio;
            this.indexAudio++, updateStylePlaylist(e, this.indexAudio), this.loadNewTrack(this.indexAudio)
        }
        this.indexAudio === listAudio.length - 1 && document.getElementById("btn-faws-next").classList.add("disable-button")
    }

    function previous() {
        if (this.currentAudio.currentTime > 10) this.currentAudio.currentTime = 0, this.setBarProgress(); else if (this.indexAudio > 0) {
            var e = this.indexAudio;
            this.indexAudio--, updateStylePlaylist(e, this.indexAudio), this.loadNewTrack(this.indexAudio)
        }
        this.indexAudio < listAudio.length - 1 && document.getElementById("btn-faws-next").classList.remove("disable-button")
    }

    function updateStylePlaylist(e, t) {
        document.querySelector("#ptc-" + e).classList.remove("active-track"), this.pauseToPlay(e), document.querySelector("#ptc-" + t).classList.add("active-track"), this.playToPause(t)
    }

    function playToPause(e) {
        var t = document.querySelector("#p-img-" + e);
        t.classList.remove("fa-play"), t.classList.add("fa-pause")
    }

    function pauseToPlay(e) {
        var t = document.querySelector("#p-img-" + e);
        t.classList.remove("fa-pause"), t.classList.add("fa-play")
    }

    progressbar.addEventListener("click", seek.bind(this));
}