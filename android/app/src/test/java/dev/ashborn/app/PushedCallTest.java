package dev.ashborn.app;

import static org.junit.Assert.assertEquals;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

// A call pushed to the phone rings at once if already due, survives a schedule built from rows read
// before it existed, and the background log keeps only its last entries
public class PushedCallTest {
    private static final long NOW = 1_800_000_000_000L;
    private static final Alarm CALL = new Alarm("alarm:c@" + (NOW + 30_000), NOW + 30_000, "Claude needs you", "plain", Alarm.CALL);
    private static final AlarmScheduler.Pushed PUSHED = new AlarmScheduler.Pushed(CALL, NOW - 5_000);

    private static List<AlarmScheduler.Pushed> kept(long readAt, String... scheduled) {
        return AlarmScheduler.stillPushed(Arrays.asList(PUSHED), new HashSet<>(Arrays.asList(scheduled)), readAt, NOW);
    }

    private static final Alarm DUE = new Alarm("alarm:c@" + NOW, NOW, "Claude needs you", "plain", Alarm.CALL);
    private static final Set<String> NONE_RUNG = Collections.emptySet();

    // call_user sets a call for now, so it arrives already due: it rings at once, under its own key
    @Test
    public void aCallAlreadyDueRingsAtOnce() {
        Alarm armed = AlarmScheduler.due(DUE, NOW + 3_000, NONE_RUNG);
        assertEquals(NOW + 4_000, armed.at);
        assertEquals(DUE.key, armed.key);
        assertEquals(true, armed.isCall());
        assertEquals(false, AlarmService.staleCall(armed, armed.at));
        assertEquals(CALL, AlarmScheduler.due(CALL, NOW, NONE_RUNG));
    }

    // Rung once, a call is not rung again by a refresh or a repeated push; over two minutes late it
    // is not rung at all; a plain alarm past is never rung
    @Test
    public void aDueCallRingsOnceAndNotLate() {
        assertEquals(null, AlarmScheduler.due(DUE, NOW + 3_000, Collections.singleton(DUE.key)));
        assertEquals(null, AlarmScheduler.due(DUE, NOW + AlarmService.CALL_STALE_MS + 1, NONE_RUNG));
        Alarm plain = new Alarm("alarm:p@" + NOW, NOW, "Pills", "plain", Alarm.DEFAULT);
        assertEquals(null, AlarmScheduler.due(plain, NOW + 1, NONE_RUNG));
    }

    @Test
    public void rowsReadBeforeThePushKeepTheCall() {
        assertEquals(1, kept(NOW - 10_000).size());
    }

    @Test
    public void rowsReadAfterThePushWithoutTheCallDropIt() {
        assertEquals(0, kept(NOW - 1_000).size());
    }

    @Test
    public void rowsThatHaveTheCallKeepIt() {
        assertEquals(1, kept(NOW - 1_000, CALL.key).size());
    }

    // The app's hand-over (read time unknown, 0) never drops a call
    @Test
    public void anUnknownReadTimeKeepsTheCall() {
        assertEquals(1, kept(0).size());
    }

    @Test
    public void aCallRungIsDropped() {
        assertEquals(0, AlarmScheduler.stillPushed(Arrays.asList(PUSHED), Collections.emptySet(), 0, CALL.at).size());
    }

    @Test
    public void theLogKeepsItsLastEntries() throws Exception {
        JSONArray log = new JSONArray();
        for (int i = 0; i < Diagnostics.KEPT + 5; i++) log = Diagnostics.appended(log, new JSONObject().put("at", i));
        assertEquals(Diagnostics.KEPT, log.length());
        assertEquals(5, log.getJSONObject(0).getInt("at"));
        assertEquals(Diagnostics.KEPT + 4, log.getJSONObject(Diagnostics.KEPT - 1).getInt("at"));
    }
}
