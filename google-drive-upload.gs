/**
 * Zkopírujte celý tento soubor do projektu na https://script.google.com
 * (viz github-a-google-disk-navod.txt). Složka na Disku je nastavená níže.
 */
var FOLDER_ID = '1uT1p5MxF1VSp8EvEGmoFOqgaTSH1IiPv';

function doPost(e) {
  try {
    var body = '{}';
    if (e && e.postData && e.postData.contents) {
      body = e.postData.contents;
    } else if (e && e.parameter && e.parameter.payload) {
      body = e.parameter.payload;
    }
    var data = JSON.parse(body);
    var filename = data.filename || ('DigiTool_' + new Date().getTime() + '.json');
    var content = data.content || '';
    var folder = DriveApp.getFolderById(FOLDER_ID);
    folder.createFile(filename, content, MimeType.PLAIN_TEXT);
    return ContentService.createTextOutput(JSON.stringify({ ok: true, filename: filename }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService.createTextOutput('DigiTool – odesílání na Google Disk běží.');
}
