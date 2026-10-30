const steps={
 welcome:{icon:'discover',title:'Willkommen bei TierFinder',text:'Lerne die wichtigsten Funktionen in wenigen Schritten kennen. Du kannst jederzeit überspringen und diese Einführung später unter Profil → Einstellungen erneut öffnen.',preview:'In Ruhe kennenlernen',detail:'Diese Tour erklärt die App. Sie speichert keine Likes, stellt keine Anfragen und verändert keine Tiere.'},
 discover:{icon:'discover',title:'Entdecke deine Tierarten',text:'Unter Entdecken siehst du verfügbare Tiere deiner gespeicherten Tierpräferenzen. Über „Ändern“ legst du im Profil fest, welche Tierarten dich interessieren.',preview:'Deine Auswahl zählt',detail:'Die Reihenfolge ist gemischt. Öffne „Profil ansehen“, um mehr über ein Tier und seine Vermittlung zu erfahren.'},
 swipe:{icon:'likes',title:'Wischen, merken, zurückholen',text:'Wische nach rechts zum Merken und nach links zum Überspringen. Du kannst auch die beiden Schaltflächen auf der Karte verwenden.',preview:'← Überspringen     Merken →',detail:'Versehentlich weitergewischt? Der Zurück-Pfeil neben den Tierarten holt das zuletzt übersprungene, noch verfügbare Tier deiner Auswahl zurück.'},
 likes:{icon:'likes',title:'Deine Likes sind deine Merkliste',text:'Hier findest du die Tiere, die du dir gemerkt hast. Ein Like ist noch keine Kennenlernanfrage.',preview:'Erst merken, dann kennenlernen',detail:'Öffne ein Tierprofil und wähle bewusst „Kennenlernen anfragen“. Verfügbarkeit und bisherige Anfragen werden im Profil angezeigt.'},
 requests:{icon:'requests',title:'Behalte deine Anfragen im Blick',text:'Im Tab Anfragen siehst du, ob ein Kennenlernen noch offen, bestätigt oder abgelehnt ist. Offene Anfragen kannst du zurückziehen.',preview:'Offen → Bestätigt',detail:'Nach Bestätigung findest du Termin, Treffpunkt und Chat direkt in der Anfrage. Rote Punkte zeigen neue Aktivität. Beide Seiten können das Kennenlernen absagen; eine Bestätigung ist noch keine Adoption.'},
 ai:{icon:'ai',title:'Entdecke dein tierisches Lookalike',text:'Wähle ein generiertes Porträt oder das Beispielbild. Nach deiner Zustimmung vergleicht Gemini es mit den Tierfotos deiner Auswahl.',preview:'Ein spielerischer Bildvergleich',detail:'Optische Ähnlichkeit sagt nichts über die Eignung zur Adoption aus. Der Vergleich kann etwas dauern und unterliegt einem Kontingent.'},
 shelter:{icon:'shelter',title:'Verwalte deine Tierprofile',text:'Unter Tiere kannst du ein Profil als Entwurf anlegen, Angaben und Bilder bearbeiten und es anschließend verfügbar machen.',preview:'Entwurf → Verfügbar → Pausiert',detail:'„Vermittelt“ ist endgültig. Beim Löschen verschwindet das Profil; offene und bestätigte Anfragen werden geschlossen. Die Anfragehistorie bleibt erhalten.'},
 handling:{icon:'requests',title:'Bearbeite Kennenlernanfragen',text:'Im Tab Anfragen kannst du offene Anfragen bestätigen oder ablehnen. Eine Bestätigung setzt das Tier automatisch auf pausiert.',preview:'Bestätigung pausiert das Tier',detail:'Nach Bestätigung könnt ihr direkt in der Anfrage chatten. Trage Termin, Treffpunkt und Hinweise ein. Bei einer Absage entscheidest du bewusst, ob das Tier wieder verfügbar wird.'},
 admin:{icon:'admin',title:'Verwalte Freigaben',text:'Unter Verwaltung gibst du Konten beziehungsweise Organisationen frei und kannst Links zum Zurücksetzen eines Passworts erstellen.',preview:'Freigaben bewusst prüfen',detail:'Als Master-Admin kannst du außerdem Tiere aller Organisationen verwalten. Weitere Bereiche findest du bei Bedarf im Tab Mehr.'},
 settings:{icon:'profile',title:'So fühlt sich TierFinder nach dir an',text:'Unter Profil → Einstellungen wechselst du zwischen Hell, Dunkel und System. Hier kannst du auch jederzeit das Tutorial erneut starten.',preview:'Hell · Dunkel · System',detail:'Die Darstellung wird auf diesem Gerät gespeichert. Deine Tierpräferenzen und dein Anzeigename stehen direkt darüber.'}
};
export function tutorialSteps(account){
 const master=account.role==='ADMIN'&&account.is_admin;
 const ids=['welcome'];
 if(account.role==='SHELTER'||master)ids.push('shelter','handling');
 if(account.role==='INTERESTED'||master)ids.push('discover','swipe','likes','requests','ai');
 if(account.is_admin)ids.push('admin');ids.push('settings');
 return ids.map(id=>({id,...steps[id]}));
}
export function createTutorialMemory(storage=()=>localStorage){
 const memory=new Set();
 const key=(user,account)=>'tierfinder.tutorial.v1:'+user+':'+account.role+':'+Boolean(account.is_admin);
 return {seen(user,account){const k=key(user,account);try{return memory.has(k)||storage().getItem(k)==='done';}catch{return memory.has(k);}},mark(user,account){const k=key(user,account);memory.add(k);try{storage().setItem(k,'done');}catch{}}};
}
