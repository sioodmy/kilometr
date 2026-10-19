package my.siood.kilometr.widgets;

import static org.junit.Assert.*;
import android.app.Application;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.res.Configuration;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.TextView;
import android.view.ViewGroup;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=34)
public class WidgetRenderTest {
  private final Context context = RuntimeEnvironment.getApplication();
  private final long now = 10000000L;
  private JSONObject snapshot() throws Exception {
    return new JSONObject("{\"labels\":{\"journeyTitle\":\"Your Kilometr\",\"trackingTitle\":\"Your trip\",\"arriveIn\":\"arrives in {n} min\",\"departIn\":\"leaves in {n} min\",\"arrived\":\"Arrived\",\"search\":\"Where to?\",\"checkRoutes\":\"Find connections\",\"min\":\"min\"},\"places\":[{\"name\":\"Home\",\"icon\":\"home\",\"deepLink\":\"kilometr://routes?toTitle=Home\"}]}");
  }
  private Bundle size(int w,int h) { Bundle b=new Bundle();b.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,w);b.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,h);return b; }
  private View apply(RemoteViews remote,int w,int h) {
    return applyWithContext(context,remote,w,h);
  }
  private View applyWithContext(Context ctx,RemoteViews remote,int w,int h) {
    View v=remote.apply(ctx,null);
    v.measure(View.MeasureSpec.makeMeasureSpec(w,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(h,View.MeasureSpec.EXACTLY));
    v.layout(0,0,w,h);return v;
  }
  @Test public void morphsAndPreservesPlaces() throws Exception {
    JSONObject snap=snapshot();
    View idle=apply(WidgetRenderers.INSTANCE.journey(context,snap,1,size(320,240),now),320,240);
    assertNotNull(idle.findViewById(R.id.kw_rows));
    assertEquals("Home",((TextView)idle.findViewById(R.id.kw_row_title)).getText().toString());
    snap.put("pinned",new JSONObject().put("fromTitle","Start").put("toTitle","Work").put("departTs",now-600000).put("arriveTs",now+600000));
    View active=apply(WidgetRenderers.INSTANCE.journey(context,snap,1,size(320,240),now),320,240);
    assertEquals("Work",((TextView)active.findViewById(R.id.kw_title)).getText().toString());
    assertEquals("arrives in 10 min",((TextView)active.findViewById(R.id.kw_phase)).getText().toString());
    View arrived=apply(WidgetRenderers.INSTANCE.journey(context,snap,1,size(320,240),now+600000),320,240);
    assertEquals("Arrived",((TextView)arrived.findViewById(R.id.kw_phase)).getText().toString());
    View back=apply(WidgetRenderers.INSTANCE.journey(context,snap,1,size(320,240),now+720001),320,240);
    assertNotNull(back.findViewById(R.id.kw_rows));
    snap.remove("pinned");
    assertNotNull(apply(WidgetRenderers.INSTANCE.journey(context,snap,1,size(220,110),now),220,110).findViewById(R.id.kw_rows));
  }
  @Test public void emptyAndAllWidgetsInflate() throws Exception {
    for(int[] dim:new int[][]{{110,110},{220,110},{320,240},{400,320}}) {
      apply(WidgetRenderers.INSTANCE.next(context,null,1,size(dim[0],dim[1]),now),dim[0],dim[1]);
      apply(WidgetRenderers.INSTANCE.journey(context,null,1,size(dim[0],dim[1]),now),dim[0],dim[1]);
      apply(WidgetRenderers.INSTANCE.savedPlaces(context,snapshot(),1,size(dim[0],dim[1])),dim[0],dim[1]);
      apply(WidgetRenderers.INSTANCE.search(context,snapshot(),1,size(dim[0],dim[1])),dim[0],dim[1]);
    }
  }

  private void checkBounds(View v,int x,int y,int width,int height) {
    if(v.getVisibility()!=View.VISIBLE)return;
    int left=x+v.getLeft(),top=y+v.getTop();
    if(v instanceof TextView) {
      if(((TextView)v).getText().length()>0)assertTrue("Invisible text",v.getWidth()>0&&v.getHeight()>0);
      assertTrue(((TextView)v).getText()+" outside widget: "+top+".."+(top+v.getHeight())+" / "+height,top>=0&&top+v.getHeight()<=height);
      assertTrue("text outside width",left>=0&&left+v.getWidth()<=width);
    }
    if(v instanceof ViewGroup)for(int i=0;i<((ViewGroup)v).getChildCount();i++)checkBounds(((ViewGroup)v).getChildAt(i),left,top,width,height);
  }
  @Test public void responsiveLayoutsFit() throws Exception {
    for(float scale:new float[]{1f,1.3f,2f}) {
      Configuration config=new Configuration(context.getResources().getConfiguration());
      config.fontScale=scale;
      Context scaled=context.createConfigurationContext(config);
      for(int[] dim:new int[][]{{220,110},{280,200},{320,240},{400,320}}) {
        JSONObject snap=snapshot();
        View idle=applyWithContext(scaled,WidgetRenderers.INSTANCE.journey(scaled,snap,1,size(dim[0],dim[1]),now),dim[0],dim[1]);
        checkBounds(idle,0,0,dim[0],dim[1]);
        snap.put("pinned",new JSONObject().put("fromTitle","Start").put("toTitle","Work").put("departTs",now-600000).put("arriveTs",now+600000));
        View trip=applyWithContext(scaled,WidgetRenderers.INSTANCE.journey(scaled,snap,1,size(dim[0],dim[1]),now),dim[0],dim[1]);
        checkBounds(trip,0,0,dim[0],dim[1]);
      }
    }
  }
  private Intent nextIntent() { return Shadows.shadowOf((Application)context).getNextStartedActivity(); }
  @Test public void lineTextHasReadableContrast() {
    for(String hex:new String[]{"#F57C00","#1976D2","#00897B","#BB0000"}) {
      View badge=apply(WidgetPartsKt.lineBadge(context,"tram","4",hex,"#FFFFFF"),120,32);
      int fg=((TextView)badge.findViewById(R.id.kw_badge_text)).getCurrentTextColor();
      double contrast=androidx.core.graphics.ColorUtils.calculateContrast(fg,android.graphics.Color.parseColor(hex));
      assertTrue(hex+" fg="+Integer.toHexString(fg)+" contrast="+contrast,contrast>=4.5);
    }
  }
  @Test public void tapsOpenDestinationSearchAndTrackedTrip() throws Exception {
    JSONObject snap=snapshot();
    View idle=apply(WidgetRenderers.INSTANCE.journey(context,snap,1,size(320,240),now),320,240);
    assertTrue(idle.findViewById(R.id.kw_row).performClick());
    assertEquals("Home",nextIntent().getData().getQueryParameter("toTitle"));
    assertTrue(idle.findViewById(R.id.kw_search_action).performClick());
    assertEquals("1",nextIntent().getData().getQueryParameter("search"));
    View saved=apply(WidgetRenderers.INSTANCE.savedPlaces(context,snap,1,size(160,160)),160,160);
    assertTrue(saved.findViewById(R.id.kw_saved_place).performClick());
    assertEquals("Home",nextIntent().getData().getQueryParameter("toTitle"));
    View search=apply(WidgetRenderers.INSTANCE.search(context,snap,1,size(320,56)),320,56);
    assertTrue(search.findViewById(R.id.kw_search).performClick());
    assertEquals("1",nextIntent().getData().getQueryParameter("search"));
    assertTrue(search.findViewById(R.id.kw_place).performClick());
    assertEquals("Home",nextIntent().getData().getQueryParameter("toTitle"));
    snap.put("next",new JSONArray().put(new JSONObject().put("line","4").put("mode","tram")
      .put("dest","Home").put("departTs",now+300000).put("deepLink","kilometr://routes?toTitle=Home")));
    View next=apply(WidgetRenderers.INSTANCE.next(context,snap,1,size(160,160),now),160,160);
    assertTrue(next.performClick());
    assertEquals("Home",nextIntent().getData().getQueryParameter("toTitle"));
    snap.put("pinned",new JSONObject().put("fromTitle","Start").put("toTitle","Work")
      .put("departTs",now-600000).put("arriveTs",now+600000).put("deepLink","kilometr://routes?toTitle=Work"));
    View active=apply(WidgetRenderers.INSTANCE.journey(context,snap,1,size(320,240),now),320,240);
    assertTrue(active.performClick());
    assertEquals("Work",nextIntent().getData().getQueryParameter("toTitle"));
  }
}
