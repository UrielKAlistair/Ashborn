package dev.ashborn.app;

import static org.junit.Assert.assertEquals;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

// A call pushed to the phone survives a schedule built from rows read before it existed, and the
// background log keeps only its last entries
public class PushedCallTest {
    private static final long NOW = 1_800_000_000_000L;
    private static final Alarm CALL = new Alarm("alarm:c@" + (NOW + 30_000), NOW + 30_000, "Claude needs you", "plain", Alarm.CALL);
    private static final AlarmScheduler.Pushed PUSHED = new AlarmScheduler.Pushed(CALL, NOW - 5_000);

    private static List<AlarmScheduler.Pushed> kept(long readAt, String... scheduled) {
        return AlarmScheduler.stillPushed(Arrays.asList(PUSHED), new HashSet<>(Arrays.asList(scheduled)), readAt, NOW);
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
