// Taken almost verbatim from the demo app. However, this version works with JSON values (as requested in the lab spec),
// not just booleans.
let lights = {
    'kitchen_lights_stove': '/kitchen/lights/stove',
    'kitchen_lights_ceiling': '/kitchen/lights/ceiling',
    'livingroom_lights_sofa': '/livingroom/lights/sofa',
    'livingroom_lights_ceiling': '/livingroom/lights/ceiling',
    'bedroom_lights_bed': '/bedroom/lights/bed',
    'bedroom_lights_ceiling': '/bedroom/lights/ceiling'
};

let temps = {
    'kitchen_temperature': '/kitchen/temperature',
    'livingroom_temperature': '/livingroom/temperature',
    'bedroom_temperature': '/bedroom/temperature'
};

setInterval(refresh, 5000);

function refresh() {
    for (let id in lights) {
        let path = lights[id];
        $.getJSON(path, data => {
            $('#' + id).attr('class', !!data.status ? 'btn btn-warning btn-sm' : 'btn btn-secondary btn-sm');
        });
    }

    for (let id in temps) {
        let path = temps[id];
        $.getJSON(path, data => {
            $('#' + id).html(data.temperature + '&deg;C');
        });
    }
}

function clickLight(id) {
    let path = lights[id];
    $.post(path)
        .done(res => {
            $('#' + id).attr('class', !!res.status ? 'btn btn-warning btn-sm' : 'btn btn-secondary btn-sm');
        })
        .fail(() => {
            // Crude, but prevents a feeling of staleness
            window.location.replace('/');
        });
}

function logout() {
    $.post('/logout', data => {
        window.location.replace('/');
    });
}
