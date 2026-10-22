package com.ironpath.watch.ui.settings

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import com.ironpath.watch.ui.components.ListScreen
import com.ironpath.watch.ui.components.header
import com.ironpath.watch.ui.components.itemModifier
import com.ironpath.watch.ui.components.textItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** "10:43  rest.delivered · posted" — one short line per diagnostic event. */
fun diagnosticLine(event: JSONObject): String {
    val time = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(event.optLong("at")))
    val data = event.optJSONObject("data")
    val detail = data?.keys()?.asSequence()?.take(2)?.joinToString(" · ") { "$it ${data.opt(it)}" }.orEmpty()
    return listOf(time, event.optString("type"), detail).filter { it.isNotEmpty() }.joinToString("  ")
}

/** S13: latest 50 watch events, newest first. The full log goes to the phone on reconnect. */
@Composable
fun DiagnosticsScreen(load: () -> List<JSONObject>) {
    var events by remember { mutableStateOf<List<JSONObject>?>(null) }
    LaunchedEffect(Unit) { events = withContext(Dispatchers.IO) { load() } }
    ListScreen { spec ->
        header(spec, "Diagnostics")
        val rows = events
        when {
            rows == null -> textItem(spec, "Loading…")
            rows.isEmpty() -> textItem(spec, "No events yet")
            else -> items(rows) { event ->
                Text(diagnosticLine(event), itemModifier(spec), style = MaterialTheme.typography.bodySmall, maxLines = 2)
            }
        }
        textItem(spec, "Latest 50. The full log goes to your phone.")
    }
}
