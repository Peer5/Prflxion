var RTCPeerConnection = window.RTCPeerConnection;
var peerConn1;
var peerConn2;
var dataChannel1;
const MDNS_REGEX = /\b[a-z0-9-]+\.local\b/i;
const IPV6_REGEX = /(?:(?:(?:[A-F0-9]{1,4}:){6}|(?=(?:[A-F0-9]{0,4}:){0,6}(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![:.\w]))(([0-9A-F]{1,4}:){0,5}|:)((:[0-9A-F]{1,4}){1,5}:|:))(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}|(?=(?:[A-F0-9]{0,4}:){0,7}[A-F0-9]{0,4}(?![:.\w]))(([0-9A-F]{1,4}:){1,7}|:)((:[0-9A-F]{1,4}){1,7}|:))(?![:.\w])/i;

async function main() {

    return new Promise(async (resolve) => {
        var statsRefreshTimer = null;
        function onError(err) {
            console.log(err);
        }

        function timeToDie() {
            try {
                peerConn1.addIceCandidate = null;
                peerConn1.onicecandidate = null;
                peerConn1.close();
                peerConn1 = null;
            } catch (err) {
                console.error(err);
            } finally {
                try {
                    peerConn2.addIceCandidate = null;
                    peerConn2.onicecandidate = null;
                    peerConn2.close();
                    peerConn2 = null;
                } catch (err) {
                    console.error(err);
                }
            }
            if (statsRefreshTimer) {
                clearTimeout(statsRefreshTimer);
                statsRefreshTimer = null;
            }
            resolve();
        }

        async function connect() {
            try {
                peerConn1 = new RTCPeerConnection();
                dataChannel1 = peerConn1.createDataChannel('local-connection');
                var MDNSCandidates = [];
                peerConn1.onicecandidate = async (event) => {
                    if (event && event.candidate) {
                        if (MDNS_REGEX.test(event.candidate.candidate)) {
                            MDNSCandidates.push(event.candidate);
                        }
                    }
                    if (!event || !event.candidate) {
                        try {
                            if (MDNSCandidates.length === 2) {
                                var mdnsCandidatev4 = MDNSCandidates[0];
                                var mdnsCandidatev6 = MDNSCandidates[1];
                                var oldCandidate = JSON.parse(JSON.stringify(mdnsCandidatev6));
                                var oldCandidatev4 = JSON.parse(JSON.stringify(mdnsCandidatev4));
                                var mdnsName4 = MDNS_REGEX.exec(oldCandidatev4.candidate)[0];
                                oldCandidate.candidate = oldCandidate.candidate.replace(MDNS_REGEX,mdnsName4);
                                const newCandidate = new RTCIceCandidate(oldCandidate);
                                await peerConn2.addIceCandidate(newCandidate);
                            }
                        } catch (err) {
                            onError(err);
                        }
                        return;
                    }
                };
                peerConn2 = new RTCPeerConnection();
                peerConn2.onicecandidate = async (event) => {
                    return;
                };
                const offer = await peerConn1.createOffer();
                await peerConn1.setLocalDescription(offer);
                await peerConn2.setRemoteDescription(offer);
                const answer = await peerConn2.createAnswer();
                await peerConn2.setLocalDescription(answer);
                await peerConn1.setRemoteDescription(answer);
                startStatsRefreshInterval();
            } catch (err) {
                onError(err);
            }
        }

        function startStatsRefreshInterval() {
            function getStats() {
                var promise;
                var ctr=0;
                for (ctr = 0; ctr < 2; ctr++) {
                    try {
                        if (ctr === 0) {
                            if (peerConn1) {
                                promise = peerConn1.getStats();
                            }
                        } else {
                            if (peerConn2) {
                                promise = peerConn2.getStats();
                            }
                        }
                    } catch (err) {
                        onError(err);
                        return;
                    }

                    if (!promise || !promise.then) {
                        return;
                    }

                    promise.then(function onGetStats(rtcStatsReport) {
                        if (!rtcStatsReport || !rtcStatsReport.forEach) {
                            return;
                        }
                        rtcStatsReport.forEach(function forEachReport(report) {
                            if (report.type === 'candidate-pair') {
                                if (rtcStatsReport.get) {
                                    var reportLocalCandidate = rtcStatsReport.get(report.localCandidateId);
                                    if (reportLocalCandidate && reportLocalCandidate.ip) {
                                        var ip = reportLocalCandidate.ip;
                                        var ipElem =  document.getElementById('ip');
                                        if (IPV6_REGEX.test(ip)) {
                                            if (ip.startsWith('::ffff:')) {
                                                ip = ip.split('::ffff:')[1]
                                            }
                                        }
                                        if (ip.startsWith('127.0.0.1') || ip.startsWith('::1')) {
                                            var text = ipElem.innerText;
                                            if (text === '' || text === '127.0.0.1' || text === '::1') {
                                                ipElem.innerText = ip;
                                            }
                                        }
                                        else {
                                            ipElem.innerText = ip;
                                        }
                                    }
                                }
                            }
                        });
                        if (ctr >= 1 && peerConn1 && peerConn2) {
                            statsRefreshTimer = setTimeout(getStats, 200);
                        }
                    }).catch(function onError(err) {
                        console.warn('Failed getting stats for peer: ' + (err && err.message));
                    });
                }
            }

            getStats();
        }
        connect();
        setTimeout(timeToDie, 5000);
    });
}

(async function () {
    main()
        .then(function (){
            console.log('died');
        })
        .catch(function (err){
            console.log('died: ',err);
        });
})();
